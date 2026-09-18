'use client';

import * as React from 'react';
import type { CartaoCorporativo, PlanoContas } from '@/lib/crm-types';
import { MAX_PARCELAS, gerarParcelas } from '@/lib/cartao-lancamentos';
import { hojeISO, num, round2 } from '@/lib/money';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Field } from '@/components/fin/Field';
import { MoneyField } from '@/components/fin/MoneyField';
import { Money } from '@/components/fin/Money';
import { Input } from '@/components/ui/input';

const CONTROLE =
  'h-10 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] ' +
  'px-2 fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[var(--fin-accent)]';

export interface FormDespesa {
  cartao_id: string;
  descricao: string;
  valor_total: number;
  data_compra: string;
  parcelas: number;
  categoria_id: string;
  fornecedor_nome: string;
  observacoes: string;
}

export function formDespesaVazio(cartaoId: string): FormDespesa {
  return {
    cartao_id: cartaoId,
    descricao: '',
    valor_total: 0,
    data_compra: hojeISO(),
    parcelas: 1,
    categoria_id: '',
    fornecedor_nome: '',
    observacoes: '',
  };
}

export type DialogDespesaProps = {
  aberto: boolean;
  form: FormDespesa;
  cartoes: CartaoCorporativo[];
  categorias: PlanoContas[];
  salvando: boolean;
  onChange: (f: FormDespesa) => void;
  onFechar: () => void;
  onConfirmar: () => void;
};

export function DialogDespesa({
  aberto, form, cartoes, categorias, salvando, onChange, onFechar, onConfirmar,
}: DialogDespesaProps) {
  const set = <K extends keyof FormDespesa>(k: K, v: FormDespesa[K]) =>
    onChange({ ...form, [k]: v });

  const cartao = cartoes.find(c => c.id === form.cartao_id);
  const parcelado = form.parcelas > 1;

  // A prévia usa a MESMA função que grava. Mostrar um número aqui e gravar
  // outro é como a pessoa perde a confiança na tela.
  const previaParcelas = React.useMemo(() => {
    if (!form.cartao_id || round2(num(form.valor_total)) <= 0) return [];
    return gerarParcelas(
      { ...form, valor_total: round2(num(form.valor_total)) },
      num(cartao?.dia_vencimento) || 10,
    );
  }, [form, cartao]);

  const previa = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field rotulo="Cartão">
          {(a) => (
            <select
              {...a}
              className={CONTROLE}
              value={form.cartao_id}
              onChange={e => set('cartao_id', e.target.value)}
            >
              {cartoes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.apelido}{c.ultimos_digitos ? ` (final ${c.ultimos_digitos})` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field rotulo="Data da compra">
          {(a) => (
            <Input
              {...a}
              aria-invalid={a['aria-invalid'] || undefined}
              type="date"
              value={form.data_compra}
              onChange={e => set('data_compra', e.target.value)}
              className={`${CONTROLE} tabular-nums`}
            />
          )}
        </Field>
      </div>

      <Field rotulo="Descrição" ajuda="O que foi comprado. É o que vai aparecer na conta a pagar.">
        {(a) => (
          <Input
            {...a}
            aria-invalid={a['aria-invalid'] || undefined}
            value={form.descricao}
            placeholder="Por exemplo: assinatura de software"
            onChange={e => set('descricao', e.target.value)}
            className={CONTROLE}
          />
        )}
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MoneyField
          rotulo="Valor total da compra"
          valor={form.valor_total}
          onChange={v => set('valor_total', v)}
        />

        <Field rotulo="Categoria">
          {(a) => (
            <select
              {...a}
              className={CONTROLE}
              value={form.categoria_id}
              onChange={e => set('categoria_id', e.target.value)}
            >
              <option value="">Sem categoria</option>
              {categorias
                .filter(c => c.tipo === 'DESPESA' && c.ativo)
                .map(c => <option key={c.id} value={c.id}>{c.codigo} {c.nome}</option>)}
            </select>
          )}
        </Field>
      </div>

      {/* À vista ou parcelado, com os botões mais usados à mão. */}
      <div className="flex flex-col gap-2">
        <span className="fin-t-overline text-[var(--fin-text-3)]">Como foi pago</span>
        <div className="flex flex-wrap items-center gap-2">
          {[1, 2, 3, 6, 10, 12].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => set('parcelas', n)}
              aria-pressed={form.parcelas === n}
              className={`h-9 rounded-[var(--fin-r-md)] px-3 fin-t-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] ${
                form.parcelas === n
                  ? 'bg-[var(--fin-accent)] font-semibold text-[var(--fin-text-on-fill)]'
                  : 'border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]'
              }`}
            >
              {n === 1 ? 'À vista' : `${n}x`}
            </button>
          ))}
          <label className="flex items-center gap-2 fin-t-caption text-[var(--fin-text-3)]">
            ou
            <Input
              type="number"
              min={1}
              max={MAX_PARCELAS}
              value={form.parcelas}
              onChange={e => set('parcelas', Math.min(MAX_PARCELAS, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              className={`${CONTROLE} w-20 text-right tabular-nums`}
              aria-label="Quantidade de parcelas"
            />
            até {MAX_PARCELAS}x
          </label>
        </div>
      </div>

      {/* O que vai ser criado, antes de criar. */}
      {previaParcelas.length > 0 && (
        <div className="rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] p-3">
          <p className="fin-t-overline text-[var(--fin-text-3)]">
            {parcelado ? `${previaParcelas.length} parcelas serão criadas` : 'Uma conta a pagar será criada'}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Money valor={previaParcelas[0].valor} size="metricSm" />
            {parcelado && (
              <span className="fin-t-caption text-[var(--fin-text-3)]">
                por mês, de {previaParcelas[0].competencia} a {previaParcelas[previaParcelas.length - 1].competencia}
                {previaParcelas[previaParcelas.length - 1].valor !== previaParcelas[0].valor && (
                  <> · a última é {previaParcelas[previaParcelas.length - 1].valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, com o centavo que sobra</>
                )}
              </span>
            )}
          </div>
          <p className="mt-2 fin-t-caption text-[var(--fin-text-3)]">
            A despesa entra como pendente e não move o caixa agora. Quem move o caixa é o pagamento
            da fatura.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <ConfirmDialog
      aberto={aberto}
      onOpenChange={p => { if (!p) onFechar(); }}
      titulo="Lançar despesa no cartão"
      oQueVaiAcontecer="Cria a conta a pagar de cada parcela, já ligada ao cartão, para entrar na fatura do período certo."
      previa={previa}
      confirmarRotulo={parcelado ? `Lançar ${form.parcelas} parcelas` : 'Lançar despesa'}
      processando={salvando}
      onConfirmar={onConfirmar}
    />
  );
}

export default DialogDespesa;
