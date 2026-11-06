'use client';

import * as React from 'react';

import { RecordSheet } from '@/components/fin/RecordSheet';
import { Money } from '@/components/fin/Money';
import { Field } from '@/components/fin/Field';
import { Textarea } from '@/components/ui/textarea';
import {
  api, chaveDeIdempotencia, ErroDaCobranca, type EscolhaDaPendencia, type PendenciaDaCobranca,
} from '@/lib/cobranca/contrato-telas';
import { dataBR, mensagemDeErro } from '@/lib/cobranca/regras-telas';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

/**
 * Resolver a pendência da baixa automática (E7, 06/11/2026).
 *
 * O provedor avisou que o cliente pagou, mas a baixa não entrou sozinha. A
 * janela mostra o pagamento e a conta como estão, e três caminhos, cada um
 * com a frase do que vai acontecer (vinda do servidor). Só o confirmar
 * grava; o crédito e a baixa passam pelos mesmos limites da liquidação.
 */

const ESCOLHAS: ReadonlyArray<{ id: EscolhaDaPendencia; rotulo: string; botao: string }> = [
  { id: 'corrigir', rotulo: 'Corrigir a baixa', botao: 'Dar a baixa' },
  { id: 'credito', rotulo: 'Guardar como crédito do cliente', botao: 'Guardar o crédito' },
  { id: 'ignorar', rotulo: 'Já está resolvido', botao: 'Marcar como resolvida' },
];

function erroLegivel(e: unknown): string {
  if (e instanceof ErroDaCobranca) return mensagemDeErro(e.codigo, e.message, e.status);
  return mensagemDeErro(null, e instanceof Error ? e.message : '');
}

export function ResolverPendencia({ cobrancaId, onFechar, onResolvida }: {
  /** null fecha a janela. */
  cobrancaId: string | null;
  onFechar: () => void;
  onResolvida: () => void;
}) {
  const aberto = cobrancaId !== null;
  const [plano, setPlano] = React.useState<PendenciaDaCobranca | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [escolha, setEscolha] = React.useState<EscolhaDaPendencia | null>(null);
  const [motivo, setMotivo] = React.useState('');
  const [gravando, setGravando] = React.useState(false);
  const chave = React.useRef('');

  React.useEffect(() => {
    if (!cobrancaId) return;
    let vivo = true;
    setPlano(null); setErro(null); setMotivo(''); setEscolha(null);
    chave.current = chaveDeIdempotencia();
    api.pendencia(cobrancaId)
      .then(p => {
        if (!vivo) return;
        setPlano(p);
        // Começa no primeiro caminho que vale; "já está resolvido" é o último recurso.
        setEscolha(ESCOLHAS.find(e => p.escolhas[e.id].pode)?.id ?? 'ignorar');
      })
      .catch(e => { if (vivo) setErro(erroLegivel(e)); });
    return () => { vivo = false; };
  }, [cobrancaId]);

  const motivoCurto = escolha === 'ignorar' && motivo.replace(/\s/g, '').length < 10;

  async function confirmar() {
    if (!cobrancaId || !escolha || gravando) return;
    if (motivoCurto) { setErro('Diga por que (pelo menos 10 letras): o motivo fica no histórico da cobrança.'); return; }
    setGravando(true);
    setErro(null);
    try {
      await api.resolverPendencia(cobrancaId, escolha, motivo.trim(), chave.current);
      toast.success(
        escolha === 'corrigir' ? 'Baixa registrada' : escolha === 'credito' ? 'Crédito guardado na carteira do cliente' : 'Pendência resolvida',
        escolha === 'ignorar' ? 'O motivo ficou no histórico da cobrança.' : 'A conta a receber e o caixa já mostram o pagamento.',
      );
      onResolvida();
      onFechar();
    } catch (e) {
      setErro(erroLegivel(e));
    } finally {
      setGravando(false);
    }
  }

  const p = plano?.pagamento ?? null;
  const opcao = plano && escolha ? plano.escolhas[escolha] : null;
  const rotuloDoBotao = ESCOLHAS.find(e => e.id === escolha)?.botao ?? 'Confirmar';

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Pagamento que não baixou sozinho"
      descricao="O provedor avisou que o cliente pagou, mas a conta a receber não foi baixada. Escolha o que fazer com o dinheiro."
      largura={640}
      resumo={opcao?.pode ? opcao.frase : undefined}
      acaoPrimaria={{ rotulo: rotuloDoBotao, onClick: confirmar, carregando: gravando, desabilitado: !plano || !opcao?.pode || motivoCurto }}
      acaoSecundaria={{ rotulo: 'Voltar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        {!plano && !erro ? (
          <div aria-busy="true" className="flex flex-col gap-[var(--fin-s-2)]">
            <span className="block h-5 w-56 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
            <span className="block h-16 animate-pulse rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
            <span className="sr-only" role="status">Lendo o pagamento.</span>
          </div>
        ) : null}

        {plano ? (
          <>
            <p className="rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-warning-text)]">
              {plano.pendencia}
            </p>

            <dl className="grid grid-cols-2 gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-2)] fin-t-body sm:grid-cols-4">
              <div className="flex flex-col">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">Pago pelo cliente</dt>
                <dd>{p ? <Money valor={p.valor_centavos / 100} size="body" align="esquerda" estado="ok" /> : '—'}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">Em</dt>
                <dd className="tabular-nums text-[var(--fin-text)]">{p ? `${dataBR(p.data)} · ${p.forma}` : '—'}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">Taxa do provedor</dt>
                <dd>{p ? <Money valor={p.taxa_centavos / 100} size="body" align="esquerda" estado="ok" /> : '—'}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">A conta hoje</dt>
                <dd className="text-[var(--fin-text)]">
                  {!plano.conta ? 'Não existe mais'
                    : plano.conta.status === 'CANCELADO' ? 'Cancelada'
                      : plano.conta.saldo > 0 ? <>Falta <Money valor={plano.conta.saldo} size="body" align="esquerda" className="inline-block min-w-0" estado="ok" /></>
                        : 'Já recebida'}
                </dd>
              </div>
            </dl>

            <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
              <legend className="mb-[var(--fin-s-2)] fin-t-body-strong text-[var(--fin-text)]">O que fazer</legend>
              {ESCOLHAS.map(e => {
                const o = plano.escolhas[e.id];
                const ativo = escolha === e.id;
                return (
                  <label
                    key={e.id}
                    className={cn(
                      'flex items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border p-[var(--fin-s-3)]',
                      'transition-[border-color,background-color] duration-[var(--fin-dur-rapida)] motion-reduce:transition-none',
                      'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--fin-accent)]',
                      !o.pode ? 'cursor-not-allowed border-[var(--fin-border)] bg-[var(--fin-surface-sunken)]'
                        : ativo ? 'cursor-pointer border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]'
                          : 'cursor-pointer border-[var(--fin-border)] bg-[var(--fin-surface)] hover:bg-[var(--fin-surface-2)]',
                    )}
                  >
                    <input
                      type="radio"
                      name="pendencia-escolha"
                      value={e.id}
                      checked={ativo}
                      disabled={!o.pode}
                      onChange={() => { setEscolha(e.id); setErro(null); }}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={cn('fin-t-body-strong', o.pode ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]')}>
                        {e.rotulo}
                        {e.id === 'credito' && o.pode && o.credito ? (
                          <span className="ml-[var(--fin-s-2)] font-normal text-[var(--fin-text-2)]">
                            <Money valor={o.credito} size="body" align="esquerda" className="inline-block min-w-0" estado="ok" />
                          </span>
                        ) : null}
                      </span>
                      <span className="fin-t-caption text-[var(--fin-text-2)]">{o.frase}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {escolha === 'ignorar' ? (
              <Field rotulo="Por que já está resolvido" ajuda="Fica no histórico da cobrança. Ex.: a baixa feita à mão no dia 05 foi este mesmo pagamento.">
                {a => (
                  <Textarea
                    {...a}
                    value={motivo}
                    onChange={ev => setMotivo(ev.target.value)}
                    rows={3}
                    maxLength={500}
                    className="rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body"
                  />
                )}
              </Field>
            ) : null}
          </>
        ) : null}

        {erro ? <p role="alert" className="rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] p-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}
      </div>
    </RecordSheet>
  );
}
