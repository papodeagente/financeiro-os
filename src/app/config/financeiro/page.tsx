'use client';

import { useEffect, useState } from 'react';
import { Percent } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { Money } from '@/components/fin/Money';
import { PageHeader } from '@/components/fin/PageHeader';
import { calcularEncargos, type PoliticaCobranca } from '@/lib/baixa-calculo';
import { addDias, hojeISO, num } from '@/lib/money';
import { toast } from '@/lib/toast';

const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body tabular-nums lg:h-10';
const VAZIA: PoliticaCobranca = { juros_am_pct: 0, multa_pct: 0, tolerancia_dias: 0, desconto_antecipacao: null, aplicar_em_pagar: false };

function Numero({ rotulo, ajuda, valor, onChange, unidade, max }: {
  rotulo: string; ajuda?: string; valor: number; onChange: (v: number) => void; unidade: string; max: number;
}) {
  return (
    <Field rotulo={rotulo} ajuda={ajuda}>
      {a => (
        <div className="relative">
          <Input
            {...a}
            type="number"
            inputMode="decimal"
            min={0}
            max={max}
            step="0.01"
            value={Number.isFinite(valor) ? String(valor) : ''}
            onChange={e => onChange(num(e.target.value.replace(',', '.')))}
            className={`${CONTROLE} pr-12`}
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[var(--fin-s-3)] flex items-center fin-t-body text-[var(--fin-text-2)]">
            {unidade}
          </span>
        </div>
      )}
    </Field>
  );
}

/**
 * Configurações › Financeiro (05/11/2026). Juros, multa, tolerância e
 * desconto por antecipação que a liquidação SUGERE. Na hora de liquidar a
 * pessoa sempre pode mudar o valor.
 */
export default function ConfigFinanceiroPage() {
  const [p, setP] = useState<PoliticaCobranca>(VAZIA);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function load() {
    try {
      const r = await fetch('/api/config/financeiro');
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Erro ${r.status}`);
      const c = (await r.json()) as { politica_cobranca: PoliticaCobranca | null };
      setP({ ...VAZIA, ...(c.politica_cobranca ?? {}) });
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
      setEstado('erro');
    }
  }
  useEffect(() => { void load(); }, []);

  async function salvar() {
    setSalvando(true);
    try {
      const r = await fetch('/api/config/financeiro', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ politica_cobranca: p }),
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string; politica_cobranca?: PoliticaCobranca };
      if (!r.ok) throw new Error(corpo.error || `Erro ${r.status}`);
      if (corpo.politica_cobranca) setP({ ...VAZIA, ...corpo.politica_cobranca });
      toast.success('Política de juros, multa e desconto salva.');
    } catch (e) {
      toast.error('Não foi possível salvar.', e instanceof Error ? e.message : '');
    } finally {
      setSalvando(false);
    }
  }

  const d = p.desconto_antecipacao ?? { pct: 0, dias: 0 };
  const hoje = hojeISO();
  const exemploAtraso = calcularEncargos(
    { tabela: 'contas_receber', status: 'PENDENTE', valor_final: 1000, valor_baixado: 0, data_vencimento: addDias(hoje, -10) }, hoje, p,
  );
  const exemploAntes = calcularEncargos(
    { tabela: 'contas_receber', status: 'PENDENTE', valor_final: 1000, valor_baixado: 0, data_vencimento: addDias(hoje, Math.max(1, num(d.dias))) }, hoje, p,
  );

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-s-5)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={Percent}
          titulo="Financeiro"
          subtitulo="Juros, multa e desconto que a liquidação sugere. Na hora de liquidar dá para mudar o valor."
        />
        <DataState
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void load(); } } : null}
          esqueleto={<div className="h-64 rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
        >
          <section
            aria-labelledby="t-encargos"
            className="flex max-w-3xl flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]"
          >
            <h2 id="t-encargos" className="fin-t-subhead text-[var(--fin-text)]">Juros, multa e desconto</h2>
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
              <Numero rotulo="Juros ao mês" ajuda="Proporcional por dia de atraso." unidade="%" max={20}
                valor={num(p.juros_am_pct)} onChange={v => setP(x => ({ ...x, juros_am_pct: v }))} />
              <Numero rotulo="Multa por atraso" ajuda="Cobrada uma vez." unidade="%" max={20}
                valor={num(p.multa_pct)} onChange={v => setP(x => ({ ...x, multa_pct: v }))} />
              <Numero rotulo="Tolerância" ajuda="Dias sem cobrar depois do vencimento." unidade="dias" max={60}
                valor={num(p.tolerancia_dias)} onChange={v => setP(x => ({ ...x, tolerancia_dias: Math.round(v) }))} />
            </div>
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
              <Numero rotulo="Desconto por pagar antes" unidade="%" max={50}
                valor={num(d.pct)} onChange={v => setP(x => ({ ...x, desconto_antecipacao: { pct: v, dias: num(x.desconto_antecipacao?.dias) || 5 } }))} />
              <Numero rotulo="Pagando até" ajuda="Dias antes do vencimento." unidade="dias" max={60}
                valor={num(d.dias)} onChange={v => setP(x => ({ ...x, desconto_antecipacao: { pct: num(x.desconto_antecipacao?.pct), dias: Math.round(v) } }))} />
            </div>
            <label className="flex items-start gap-2 fin-t-body text-[var(--fin-text)]">
              <input
                type="checkbox"
                checked={Boolean(p.aplicar_em_pagar)}
                onChange={e => setP(x => ({ ...x, aplicar_em_pagar: e.target.checked }))}
                className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]"
              />
              <span>
                Sugerir também nas contas a pagar
                <span className="block fin-t-caption text-[var(--fin-text-3)]">Útil quando o fornecedor cobra juros pelo atraso.</span>
              </span>
            </label>
            <div className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">
              <span>
                Exemplo: uma conta de R$ 1.000,00 paga 10 dias depois do vencimento sugere juros de{' '}
                <Money valor={exemploAtraso.juros} size="caption" align="esquerda" className="inline-block min-w-0" estado="ok" /> e multa de{' '}
                <Money valor={exemploAtraso.multa} size="caption" align="esquerda" className="inline-block min-w-0" estado="ok" />.
              </span>
              {num(d.pct) > 0 ? (
                <span>
                  Paga {num(d.dias)} dias antes, sugere desconto de{' '}
                  <Money valor={exemploAntes.desconto_antecipacao} size="caption" align="esquerda" className="inline-block min-w-0" estado="ok" />.
                </span>
              ) : null}
            </div>
            <div>
              <Button type="button" onClick={() => { void salvar(); }} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </section>
        </DataState>
      </div>
    </div>
  );
}
