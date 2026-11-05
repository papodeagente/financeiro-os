'use client';

import { useCallback, useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { loadEntities } from '@/lib/crm-storage';
import { toast } from '@/lib/toast';
import type { TituloTabela } from '@/lib/baixa-calculo';
import { rotuloDaForma } from '@/lib/formas-pagamento';

type Linha = {
  id: string;
  tipo: 'baixa' | 'estorno' | 'anterior' | 'legada';
  data: string;
  conta_bancaria_id: string | null;
  forma: string;
  valor: number;
  juros: number;
  multa: number;
  desconto: number;
  taxa: number;
  origem: string;
  usuario: string | null;
  motivo: string | null;
  estornada: boolean;
  lote_id: string | null;
};

const ORIGEM: Record<string, string> = {
  tela: 'Liquidação',
  lote: 'Liquidação em lote',
  conciliacao: 'Conciliação do extrato',
  crm: 'Pagamento informado pelo CRM',
  plataforma: 'Plataforma de pagamento',
  tela_antiga: 'Baixa',
  anterior: 'Antes do histórico',
  api: 'Integração',
};

const dataBR = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/**
 * Histórico de baixas de uma conta (05/11/2026): cada pagamento/recebimento
 * com data, conta, encargos, quem fez e de onde veio, e o botão Estornar
 * para desfazer UMA baixa sem mexer nas outras.
 */
export function HistoricoDeBaixas({
  tabela,
  tituloId,
  onMudou,
}: {
  tabela: TituloTabela;
  tituloId: string;
  onMudou?: () => void;
}) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [contas, setContas] = useState<Record<string, string>>({});
  const [alvo, setAlvo] = useState<Linha | null>(null);
  const [motivo, setMotivo] = useState('');
  const [estornando, setEstornando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/baixas?titulo_tabela=${tabela}&titulo_id=${encodeURIComponent(tituloId)}`);
      setLinhas(r.ok ? ((await r.json()) as Linha[]) : []);
    } catch {
      setLinhas([]);
    }
  }, [tabela, tituloId]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    loadEntities<{ id: string; nome?: string }>('contas-bancarias')
      .then(l => setContas(Object.fromEntries(l.map(c => [c.id, c.nome || 'Conta']))))
      .catch(() => undefined);
  }, []);

  async function estornar() {
    if (!alvo) return;
    if (motivo.trim().length < 3) { toast.error('Informe o motivo do estorno.'); return; }
    setEstornando(true);
    try {
      const r = await fetch(`/api/baixas/${encodeURIComponent(alvo.id)}/estorno`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(corpo.error || `Erro ${r.status}`);
      toast.success('Baixa estornada. O valor voltou para a conta.');
      setAlvo(null);
      setMotivo('');
      await carregar();
      onMudou?.();
    } catch (e) {
      toast.error('Não foi possível estornar.', e instanceof Error ? e.message : '');
    } finally {
      setEstornando(false);
    }
  }

  const visiveis = (linhas ?? []).filter(l => l.tipo !== 'estorno');
  const sentido = tabela === 'contas_receber' ? 'recebimento' : 'pagamento';

  return (
    <section aria-labelledby="t-historico-baixas" className="mt-[var(--fin-s-5)] flex flex-col gap-[var(--fin-s-2)]">
      <h3 id="t-historico-baixas" className="fin-t-subhead text-[var(--fin-text)]">Histórico de baixas</h3>
      {linhas === null ? (
        <p className="fin-t-caption text-[var(--fin-text-3)]">Carregando…</p>
      ) : visiveis.length === 0 ? (
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          Nenhum {sentido} registrado. Use Liquidar para registrar o primeiro.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
          {visiveis.map(l => {
            const encargos = [
              l.juros ? `juros ${l.juros.toFixed(2).replace('.', ',')}` : '',
              l.multa ? `multa ${l.multa.toFixed(2).replace('.', ',')}` : '',
              l.desconto ? `desconto ${l.desconto.toFixed(2).replace('.', ',')}` : '',
              l.taxa ? `taxa ${l.taxa.toFixed(2).replace('.', ',')}` : '',
            ].filter(Boolean).join(' · ');
            return (
              <li key={l.id} className="flex items-start justify-between gap-[var(--fin-s-3)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
                <div className="min-w-0">
                  <p className={l.estornada ? 'fin-t-body text-[var(--fin-text-3)] line-through' : 'fin-t-body text-[var(--fin-text)]'}>
                    <span className="tabular-nums">{dataBR(l.data)}</span>
                    {' · '}
                    {l.conta_bancaria_id ? contas[l.conta_bancaria_id] ?? 'Conta' : 'Caixa Geral'}
                    {l.forma ? ` · ${rotuloDaForma(l.forma)}` : ''}
                  </p>
                  <p className="fin-t-caption text-[var(--fin-text-2)]">
                    {ORIGEM[l.origem] ?? l.origem}
                    {l.usuario ? ` por ${l.usuario}` : ''}
                    {encargos ? ` · ${encargos}` : ''}
                    {l.estornada ? ' · estornada' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-[var(--fin-s-2)]">
                  <Money valor={l.valor} size="body" tone={l.estornada ? 'suave' : 'neutro'} estado="ok" />
                  {!l.estornada ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setAlvo(l); setMotivo(''); }}
                      aria-label={`Estornar a baixa de ${dataBR(l.data)}`}
                    >
                      <Undo2 aria-hidden="true" className="size-4" />
                      Estornar
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        aberto={alvo !== null}
        onOpenChange={aberto => { if (!aberto) setAlvo(null); }}
        titulo="Estornar baixa"
        tone="destrutivo"
        oQueVaiAcontecer={`O ${sentido} de ${alvo ? dataBR(alvo.data) : ''} é desfeito: o valor volta para a conta onde entrou e a conta fica como estava antes dele. As outras baixas continuam valendo.`}
        detalhes={alvo ? [{ rotulo: 'Valor', valor: <Money valor={alvo.valor} size="body" estado="ok" /> }] : []}
        previa={
          <Field rotulo="Motivo do estorno" obrigatorio ajuda="Fica registrado no histórico e na auditoria.">
            {a => (
              <Textarea
                {...a}
                aria-invalid={a['aria-invalid'] || undefined}
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                rows={2}
                placeholder="Por exemplo: lançado na conta errada"
              />
            )}
          </Field>
        }
        confirmarRotulo="Estornar"
        processando={estornando}
        onConfirmar={estornar}
      />
    </section>
  );
}

export default HistoricoDeBaixas;
