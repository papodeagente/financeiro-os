'use client';

/**
 * Venda parcelada no cartão ou no boleto: receber mês a mês ou antecipar
 * tudo (13/11/2026). A regra mora em src/lib/recebimento-parcelado.ts; aqui
 * só a pergunta, a taxa e a prévia do que entra no caixa.
 */
import { useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { hojeISO, round2 } from '@/lib/money';
import type { RecebimentoDaVenda } from '@/lib/recebimento-parcelado';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => (iso && iso.length >= 10 ? iso.slice(0, 10).split('-').reverse().join('/') : '');

export function EscolhaDoRecebimento({
  vendaId, forma, parcelas, total, recebimento, onSalvo,
}: {
  vendaId: string;
  forma: string;
  parcelas: number;
  total: number;
  recebimento: RecebimentoDaVenda | undefined;
  onSalvo: () => void;
}) {
  const atual = recebimento && (recebimento.modo === 'mensal' || recebimento.modo === 'antecipado') ? recebimento : null;
  const [modo, setModo] = useState<'mensal' | 'antecipado'>(atual?.modo === 'antecipado' ? 'antecipado' : 'mensal');
  const [taxa, setTaxa] = useState(atual ? String(atual.taxa_pct).replace('.', ',') : '');
  const [data, setData] = useState(atual?.data_antecipacao ?? hojeISO());
  const [salvando, setSalvando] = useState(false);

  const pct = Number(taxa.replace(',', '.')) || 0;
  const meio = forma === 'BOLETO' ? 'boleto' : 'cartão';
  const parcela = round2(total / Math.max(1, parcelas));
  const taxaParcela = round2(parcela * (pct / 100));
  const taxaTotal = round2(total * (pct / 100));

  async function salvar() {
    setSalvando(true);
    try {
      const r = await fetch(`/api/vendas-crm/${vendaId}/recebimento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo, taxa_pct: pct, ...(modo === 'antecipado' ? { data_antecipacao: data } : {}) }),
      });
      const c = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(c.error || 'Não foi possível gravar a escolha.');
        return;
      }
      toast.success(modo === 'antecipado' ? 'Antecipação registrada.' : 'Recebimento mês a mês registrado.', 'As contas a receber da venda foram refeitas.');
      onSalvo();
    } catch {
      toast.error('Sem resposta do servidor. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  const OPCAO = 'flex-1 rounded-[var(--fin-r-md)] border px-3 py-2 text-left text-sm transition-colors';
  const CAMPO = 'h-10 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-sm text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

  return (
    <div
      id="recebimento"
      className={`mt-4 rounded-[var(--fin-r-lg)] border p-4 ${atual ? 'border-[var(--fin-border)] bg-[var(--fin-surface)]' : 'border-[var(--fin-warning)] bg-[var(--fin-warning-soft)]'}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-[var(--fin-accent)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--fin-text)]">Como a agência vai receber</h3>
          <p className="mt-0.5 text-sm text-[var(--fin-text-2)]">
            {atual
              ? atual.modo === 'antecipado'
                ? `Antecipado para ${dataBR(atual.data_antecipacao ?? '')}${atual.taxa_pct > 0 ? `, com taxa de ${String(atual.taxa_pct).replace('.', ',')}%` : ', sem taxa'}.`
                : `Mês a mês, em ${parcelas} parcelas${atual.taxa_pct > 0 ? `, com taxa de ${String(atual.taxa_pct).replace('.', ',')}% por parcela` : ', sem taxa'}.`
              : `O cliente parcelou em ${parcelas}x no ${meio}. Escolha se a agência recebe mês a mês ou antecipa tudo.`}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row" role="radiogroup" aria-label="Como receber">
        {(['mensal', 'antecipado'] as const).map(m => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={modo === m}
            onClick={() => setModo(m)}
            className={`${OPCAO} ${modo === m ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-text)]' : 'border-[var(--fin-border)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]'}`}
          >
            <span className="block font-medium">{m === 'mensal' ? 'Receber mês a mês' : 'Antecipar tudo'}</span>
            <span className="block text-xs text-[var(--fin-text-3)]">
              {m === 'mensal' ? `${parcelas} parcelas de ${BRL(parcela)}` : `${BRL(total)} de uma vez`}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-[var(--fin-text-3)]">{modo === 'mensal' ? 'Taxa por parcela (%), se houver' : 'Taxa da antecipação (%), se houver'}</span>
          <input className={CAMPO} inputMode="decimal" placeholder="0" value={taxa} onChange={e => setTaxa(e.target.value.replace(/[^\d,.]/g, ''))} />
        </label>
        {modo === 'antecipado' ? (
          <label className="block">
            <span className="text-xs text-[var(--fin-text-3)]">Data em que o dinheiro cai</span>
            <input className={CAMPO} type="date" value={data} onChange={e => setData(e.target.value)} />
          </label>
        ) : null}
      </div>

      <p className="mt-3 text-sm text-[var(--fin-text-2)]">
        {modo === 'mensal'
          ? pct > 0
            ? `Entra ${BRL(round2(parcela - taxaParcela))} por parcela (taxa de ${BRL(taxaParcela)} em cada uma).`
            : `Entra ${BRL(parcela)} por parcela.`
          : pct > 0
            ? `Entra ${BRL(round2(total - taxaTotal))} em ${dataBR(data)} (taxa de ${BRL(taxaTotal)}).`
            : `Entra ${BRL(total)} em ${dataBR(data)}.`}
        {' '}O valor cheio continua na venda; a taxa fica declarada em cada conta.
      </p>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={salvando}
          className="inline-flex h-10 items-center gap-2 rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-4 text-sm font-semibold text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] disabled:opacity-60"
        >
          {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {atual ? 'Atualizar escolha' : 'Salvar escolha'}
        </button>
      </div>
    </div>
  );
}
