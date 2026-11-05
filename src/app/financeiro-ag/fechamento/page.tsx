'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { PageHeader } from '@/components/fin/PageHeader';
import { loadEntities } from '@/lib/crm-storage';
import { addDias, hojeISO, num } from '@/lib/money';
import { toast } from '@/lib/toast';

type Periodo = { conta_bancaria_id: string; fechado_ate: string; atualizado_em: string; atualizado_por: string | null };
type Evento = { conta_bancaria_id: string; acao: 'FECHAR' | 'REABRIR'; de: string | null; ate: string | null; motivo: string | null; usuario_nome: string | null; criado_em: string };
type Conta = { id: string; nome?: string; saldo_atual?: number };

const dataBR = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body tabular-nums lg:h-10';

/**
 * Fechar Caixa (05/11/2026). Fechar até um dia trava, no banco, qualquer
 * mudança de dinheiro com data até ele: baixa, estorno, edição de valor de
 * conta já baixada, transferência, exclusão. Vale para a agência inteira ou
 * para uma conta. Reabrir só com motivo, e fica registrado.
 */
export default function FecharCaixaPage() {
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = useState<string | null>(null);
  const [datas, setDatas] = useState<Record<string, string>>({});
  const [fechando, setFechando] = useState<string | null>(null);
  const [reabrir, setReabrir] = useState<{ conta: string; ate: string; motivo: string } | null>(null);
  const [reabrindo, setReabrindo] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, cs] = await Promise.all([fetch('/api/periodos'), loadEntities<Conta>('contas-bancarias')]);
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Erro ${r.status}`);
      const corpo = (await r.json()) as { periodos: Periodo[]; eventos: Evento[] };
      setPeriodos(corpo.periodos);
      setEventos(corpo.eventos);
      setContas(cs);
      setEstado('ok');
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
      setEstado('erro');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const fechadoAte = (conta: string) => periodos.find(p => p.conta_bancaria_id === conta)?.fechado_ate ?? null;
  const nomeConta = (id: string) => (id ? contas.find(c => c.id === id)?.nome ?? 'Conta' : 'Todas as contas');
  const ontem = addDias(hojeISO(), -1);

  async function fechar(conta: string) {
    const ate = datas[conta] || ontem;
    setFechando(conta);
    try {
      const r = await fetch('/api/periodos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta_bancaria_id: conta, ate }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(corpo.error || `Erro ${r.status}`);
      toast.success(`Caixa fechado até ${dataBR(ate)}.`, nomeConta(conta));
      await load();
    } catch (e) {
      toast.error('Não foi possível fechar.', e instanceof Error ? e.message : '');
    } finally {
      setFechando(null);
    }
  }

  async function confirmarReabertura() {
    if (!reabrir) return;
    if (reabrir.motivo.trim().length < 5) { toast.error('Explique o motivo da reabertura.'); return; }
    setReabrindo(true);
    try {
      const r = await fetch('/api/periodos/reabrir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta_bancaria_id: reabrir.conta, ate: reabrir.ate || null, motivo: reabrir.motivo.trim() }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(corpo.error || `Erro ${r.status}`);
      toast.success('Caixa reaberto.', nomeConta(reabrir.conta));
      setReabrir(null);
      await load();
    } catch (e) {
      toast.error('Não foi possível reabrir.', e instanceof Error ? e.message : '');
    } finally {
      setReabrindo(false);
    }
  }

  const linhas = [{ id: '', nome: 'Todas as contas', saldo_atual: undefined as number | undefined }, ...contas.map(c => ({ id: c.id, nome: c.nome || 'Conta', saldo_atual: num(c.saldo_atual) }))];

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-s-5)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={Lock}
          titulo="Fechar Caixa"
          subtitulo="Fechar um dia trava os lançamentos de dinheiro até ele, em todas as telas e integrações. Para corrigir algo de um dia fechado, reabra com o motivo."
          onRecarregar={load}
        />

        <DataState
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void load(); } } : null}
          esqueleto={
            <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-10 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />)}
            </div>
          }
        >
          <div className="overflow-x-auto rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--fin-border)] text-left">
                  <th scope="col" className="fin-t-overline px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-[var(--fin-text-2)]">Conta</th>
                  <th scope="col" className="fin-t-overline px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-right text-[var(--fin-text-2)]">Saldo atual</th>
                  <th scope="col" className="fin-t-overline px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-[var(--fin-text-2)]">Fechado até</th>
                  <th scope="col" className="fin-t-overline px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-[var(--fin-text-2)]">Fechar até</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(l => {
                  const ate = fechadoAte(l.id);
                  return (
                    <tr key={l.id || 'agencia'} className="border-b border-[var(--fin-border)] last:border-b-0">
                      <th scope="row" className="fin-t-body-strong px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-left text-[var(--fin-text)]">
                        {l.nome}
                        {!l.id ? <span className="block fin-t-caption font-normal text-[var(--fin-text-2)]">Vale para a agência inteira</span> : null}
                      </th>
                      <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)] text-right">
                        {l.saldo_atual === undefined ? <span className="fin-t-caption text-[var(--fin-text-3)]">—</span> : <Money valor={l.saldo_atual} size="body" estado="ok" />}
                      </td>
                      <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                        {ate ? (
                          <span className="inline-flex items-center gap-[var(--fin-s-2)] fin-t-body tabular-nums text-[var(--fin-text)]">
                            <Lock aria-hidden="true" className="size-4 text-[var(--fin-text-2)]" />
                            {dataBR(ate)}
                            <Button type="button" variant="ghost" size="sm" onClick={() => setReabrir({ conta: l.id, ate: '', motivo: '' })}>
                              <LockOpen aria-hidden="true" className="size-4" />
                              Reabrir
                            </Button>
                          </span>
                        ) : (
                          <span className="fin-t-body text-[var(--fin-text-2)]">Aberto</span>
                        )}
                      </td>
                      <td className="px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                        <div className="flex items-center gap-[var(--fin-s-2)]">
                          <Input
                            type="date"
                            aria-label={`Fechar ${l.nome} até`}
                            value={datas[l.id] ?? ontem}
                            max={hojeISO()}
                            onChange={e => setDatas(d => ({ ...d, [l.id]: e.target.value }))}
                            className={`${CONTROLE} w-[11rem]`}
                          />
                          <Button type="button" variant="outline" onClick={() => { void fechar(l.id); }} disabled={fechando !== null}>
                            {fechando === l.id ? 'Fechando…' : 'Fechar'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <section aria-labelledby="t-fechamentos" className="mt-[var(--fin-s-5)] flex flex-col gap-[var(--fin-s-2)]">
            <h2 id="t-fechamentos" className="fin-t-subhead text-[var(--fin-text)]">Histórico de fechamentos</h2>
            {eventos.length === 0 ? (
              <p className="fin-t-body text-[var(--fin-text-2)]">
                Nenhum fechamento ainda. Feche o caixa depois de conferir o saldo de cada conta com o banco.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]">
                {eventos.map((e, i) => (
                  <li key={`${e.criado_em}-${i}`} className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)] px-[var(--fin-s-4)] py-[var(--fin-s-2)]">
                    <span className="fin-t-body text-[var(--fin-text)]">
                      {e.acao === 'FECHAR' ? 'Fechou' : 'Reabriu'} {nomeConta(e.conta_bancaria_id)}
                      {e.acao === 'FECHAR' ? ` até ${dataBR(e.ate)}` : e.ate ? `: agora fechado até ${dataBR(e.ate)}` : ': aberto por completo'}
                      {e.motivo ? <span className="block fin-t-caption text-[var(--fin-text-2)]">Motivo: {e.motivo}</span> : null}
                    </span>
                    <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">
                      {e.usuario_nome ? `${e.usuario_nome} · ` : ''}{dataBR(e.criado_em)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </DataState>
      </div>

      <ConfirmDialog
        aberto={reabrir !== null}
        onOpenChange={aberto => { if (!aberto) setReabrir(null); }}
        titulo="Reabrir caixa"
        tone="destrutivo"
        oQueVaiAcontecer="Os dias reabertos voltam a aceitar baixas, estornos e correções. O motivo fica registrado no histórico e na auditoria."
        detalhes={reabrir ? [
          { rotulo: 'Conta', valor: nomeConta(reabrir.conta) },
          { rotulo: 'Fechado até', valor: dataBR(fechadoAte(reabrir.conta)) },
        ] : []}
        previa={reabrir ? (
          <div className="flex flex-col gap-[var(--fin-s-3)]">
            <Field rotulo="Continuar fechado até" ajuda="Deixe vazio para reabrir tudo.">
              {a => (
                <Input {...a} type="date" value={reabrir.ate} onChange={e => setReabrir(r => (r ? { ...r, ate: e.target.value } : r))} className={CONTROLE} />
              )}
            </Field>
            <Field rotulo="Motivo" obrigatorio>
              {a => (
                <Textarea
                  {...a}
                  aria-invalid={a['aria-invalid'] || undefined}
                  rows={2}
                  value={reabrir.motivo}
                  placeholder="Por exemplo: corrigir o pagamento lançado na conta errada no dia 5"
                  onChange={e => setReabrir(r => (r ? { ...r, motivo: e.target.value } : r))}
                />
              )}
            </Field>
          </div>
        ) : null}
        confirmarRotulo="Reabrir"
        processando={reabrindo}
        onConfirmar={confirmarReabertura}
      />
    </div>
  );
}
