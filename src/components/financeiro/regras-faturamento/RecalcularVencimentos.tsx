'use client';

import * as React from 'react';
import { ArrowRight } from 'lucide-react';

import { Callout } from '@/components/fin/Callout';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { dataBR } from '@/lib/cobranca/regras-telas';
import type { MudancaDeVencimento } from '@/lib/fatura-servidor';
import { toast } from '@/lib/toast';
import { formatBRL } from '@/lib/utils';
import { apiRegras, ErroDaTela } from './api';

/**
 * "Recalcular vencimentos" (E5, parte B): depois de mudar a regra, mostra
 * item a item o que sai de cada fatura aberta e para onde vai, e só mexe
 * quando a pessoa confirma. Faturas fechadas, recebidas, movidas à mão e
 * avulsas ficam como estão. Sem nada a mudar e com regra nova, oferece juntar
 * já os itens soltos do cliente nas faturas.
 */
export function RecalcularVencimentos({
  pessoa, regraNova, onFechar,
}: {
  pessoa: { id: string; nome: string } | null;
  regraNova: boolean;
  onFechar: () => void;
}) {
  const [estado, setEstado] = React.useState<{ carregando: boolean; erro: string | null; mudancas: MudancaDeVencimento[] | null }>({ carregando: false, erro: null, mudancas: null });
  const [aplicando, setAplicando] = React.useState(false);

  React.useEffect(() => {
    if (!pessoa) return;
    let vivo = true;
    setEstado({ carregando: true, erro: null, mudancas: null });
    apiRegras.recalcular(pessoa.id, false)
      .then(r => { if (vivo) setEstado({ carregando: false, erro: null, mudancas: r.mudancas }); })
      .catch(e => { if (vivo) setEstado({ carregando: false, erro: e instanceof ErroDaTela ? e.message : 'Não foi possível calcular agora.', mudancas: null }); });
    return () => { vivo = false; };
  }, [pessoa]);

  if (!pessoa) return null;
  const mudancas = estado.mudancas ?? [];
  const nenhuma = estado.mudancas !== null && mudancas.length === 0;

  async function aplicar() {
    if (!pessoa) return;
    setAplicando(true);
    try {
      if (nenhuma) {
        const r = await fetch('/api/faturas/alocar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pessoa_id: pessoa.id }) });
        const corpo = await r.json().catch(() => null) as { alocados?: unknown[]; error?: string } | null;
        if (!r.ok) throw new Error(corpo?.error ?? 'Não foi possível montar as faturas agora.');
        const n = corpo?.alocados?.length ?? 0;
        toast.success(n ? `${n} ${n === 1 ? 'item entrou' : 'itens entraram'} nas faturas de ${pessoa.nome}` : `Nenhum item solto de ${pessoa.nome} para juntar`);
      } else {
        const r = await apiRegras.recalcular(pessoa.id, true);
        toast.success(`Vencimentos recalculados: ${r.mudancas.length} ${r.mudancas.length === 1 ? 'item mudou' : 'itens mudaram'} de fatura`);
      }
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setAplicando(false);
    }
  }

  const total = mudancas.reduce((a, m) => a + m.valor_centavos, 0);

  return (
    <RecordSheet
      aberto={Boolean(pessoa)}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Recalcular vencimentos"
      descricao={`As faturas abertas de ${pessoa.nome} foram montadas pela regra anterior. Veja o que muda antes de confirmar.`}
      largura={640}
      resumo={nenhuma
        ? (regraNova ? 'Nenhuma fatura aberta muda. Você pode juntar agora, pela regra nova, os itens a faturar que estavam soltos.' : 'Nenhuma fatura aberta muda com a regra nova.')
        : mudancas.length ? `${mudancas.length} ${mudancas.length === 1 ? 'item muda' : 'itens mudam'} de fatura (${formatBRL(total / 100)}). Faturas que ficarem vazias são canceladas.` : undefined}
      acaoPrimaria={{
        rotulo: nenhuma ? (regraNova ? 'Juntar os itens soltos' : 'Fechar') : `Recalcular ${mudancas.length || ''} ${mudancas.length === 1 ? 'item' : 'itens'}`.replace('  ', ' '),
        onClick: nenhuma && !regraNova ? onFechar : aplicar,
        carregando: aplicando || estado.carregando,
        desabilitado: Boolean(estado.erro),
      }}
      acaoSecundaria={nenhuma && !regraNova ? null : { rotulo: 'Agora não', onClick: onFechar }}
    >
      {estado.carregando ? (
        <div aria-busy="true" className="flex flex-col gap-[var(--fin-s-2)]">
          {[0, 1, 2].map(i => <span key={i} className="block h-14 animate-pulse rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />)}
          <span className="sr-only" role="status">Calculando o que muda.</span>
        </div>
      ) : estado.erro ? (
        <Callout tom="negativo" titulo="Não deu para calcular">{estado.erro}</Callout>
      ) : nenhuma ? (
        <p className="fin-t-body text-[var(--fin-text-2)]">Todos os itens das faturas abertas continuam no mesmo período e com o mesmo vencimento.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
          {mudancas.map(m => (
            <li key={m.conta_id} className="flex flex-col gap-1 px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
              <div className="flex items-start justify-between gap-[var(--fin-s-3)]">
                <span className="min-w-0 fin-t-body text-[var(--fin-text)]">{m.descricao || 'Item'}</span>
                <span className="shrink-0 fin-t-body-strong tabular-nums text-[var(--fin-text)]">{formatBRL(m.valor_centavos / 100)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-[var(--fin-s-2)] fin-t-caption tabular-nums text-[var(--fin-text-2)]">
                <span>Fatura Nº {m.de.numero}, vence {dataBR(m.de.vencimento)}</span>
                <ArrowRight aria-label="passa para" className="size-3.5 text-[var(--fin-text-3)]" />
                <span className={m.para.vencimento ? 'text-[var(--fin-text)]' : 'text-[var(--fin-warning-text)]'}>
                  {m.para.vencimento ? `fatura que vence ${dataBR(m.para.vencimento)}` : 'sai da fatura'}
                </span>
              </div>
              {m.para.motivo ? <span className="fin-t-caption text-[var(--fin-text-3)]">{m.para.motivo}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </RecordSheet>
  );
}
