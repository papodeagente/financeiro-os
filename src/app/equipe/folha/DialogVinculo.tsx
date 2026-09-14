'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import type { BeneficioFolha, TipoContrato, VinculoEmpresa } from '@/lib/crm-types';
import {
  ENCARGO_SUGERIDO, PROVISIONA_POR_PADRAO, ROTULO_CONTRATO, custoMensal,
} from '@/lib/folha-pagamento';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Field } from '@/components/fin/Field';
import { MoneyField } from '@/components/fin/MoneyField';
import { Money } from '@/components/fin/Money';
import { Input } from '@/components/ui/input';
import { hojeISO } from '@/lib/money';

const CONTROLE =
  'h-10 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] ' +
  'px-2 fin-t-body text-[var(--fin-text)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

export function vinculoVazio(): VinculoEmpresa {
  return {
    tipo_contrato: 'CLT',
    cargo: '',
    data_admissao: hojeISO(),
    data_desligamento: '',
    salario_base: 0,
    beneficios: [],
    encargos_pct: ENCARGO_SUGERIDO.CLT,
    provisiona_13_ferias: PROVISIONA_POR_PADRAO.CLT,
    na_folha: true,
    observacoes: '',
  };
}

export type DialogVinculoProps = {
  aberto: boolean;
  nome: string;
  vinculo: VinculoEmpresa;
  salvando: boolean;
  onChange: (v: VinculoEmpresa) => void;
  onFechar: () => void;
  onConfirmar: () => void;
};

export function DialogVinculo({
  aberto, nome, vinculo, salvando, onChange, onFechar, onConfirmar,
}: DialogVinculoProps) {
  const custo = custoMensal(vinculo);
  const set = <K extends keyof VinculoEmpresa>(k: K, v: VinculoEmpresa[K]) =>
    onChange({ ...vinculo, [k]: v });

  /** Trocar o contrato ajusta encargo e provisão para o padrão do novo tipo.
   *  Só quando o valor atual ainda é o sugerido do tipo anterior, para não
   *  apagar número que a agência digitou à mão. */
  function trocarContrato(novo: TipoContrato) {
    const eraSugerido = vinculo.encargos_pct === ENCARGO_SUGERIDO[vinculo.tipo_contrato];
    onChange({
      ...vinculo,
      tipo_contrato: novo,
      encargos_pct: eraSugerido ? ENCARGO_SUGERIDO[novo] : vinculo.encargos_pct,
      provisiona_13_ferias: eraSugerido ? PROVISIONA_POR_PADRAO[novo] : vinculo.provisiona_13_ferias,
    });
  }

  function mexerBeneficio(i: number, campo: keyof BeneficioFolha, valor: string | number) {
    const lista = [...vinculo.beneficios];
    lista[i] = { ...lista[i], [campo]: valor } as BeneficioFolha;
    set('beneficios', lista);
  }

  const previa = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field rotulo="Tipo de contrato">
          {(a) => (
            <select
              {...a}
              className={CONTROLE}
              value={vinculo.tipo_contrato}
              onChange={(e) => trocarContrato(e.target.value as TipoContrato)}
            >
              {(Object.keys(ROTULO_CONTRATO) as TipoContrato[]).map(t => (
                <option key={t} value={t}>{ROTULO_CONTRATO[t]}</option>
              ))}
            </select>
          )}
        </Field>

        <Field rotulo="Cargo">
          {(a) => (
            <Input
              {...a}
              aria-invalid={a['aria-invalid'] || undefined}
              value={vinculo.cargo}
              placeholder="Por exemplo: consultor de viagens"
              onChange={(e) => set('cargo', e.target.value)}
              className={CONTROLE}
            />
          )}
        </Field>

        <MoneyField
          rotulo="Salário base"
          valor={vinculo.salario_base}
          onChange={(v) => set('salario_base', v)}
        />

        <Field rotulo="Encargos sobre o salário (%)" ajuda={`Sugestão para ${ROTULO_CONTRATO[vinculo.tipo_contrato]}: ${ENCARGO_SUGERIDO[vinculo.tipo_contrato]}%. Confirme com sua contabilidade.`}>
          {(a) => (
            <Input
              {...a}
              aria-invalid={a['aria-invalid'] || undefined}
              type="number"
              min={0}
              max={200}
              step={0.1}
              inputMode="decimal"
              value={vinculo.encargos_pct}
              onChange={(e) => set('encargos_pct', Number(e.target.value) || 0)}
              className={`${CONTROLE} text-right tabular-nums`}
            />
          )}
        </Field>

        <Field rotulo="Admissão">
          {(a) => (
            <Input
              {...a}
              aria-invalid={a['aria-invalid'] || undefined}
              type="date"
              value={vinculo.data_admissao}
              onChange={(e) => set('data_admissao', e.target.value)}
              className={`${CONTROLE} tabular-nums`}
            />
          )}
        </Field>

        <Field rotulo="Desligamento" ajuda="Em branco enquanto a pessoa está na empresa.">
          {(a) => (
            <Input
              {...a}
              aria-invalid={a['aria-invalid'] || undefined}
              type="date"
              value={vinculo.data_desligamento}
              onChange={(e) => set('data_desligamento', e.target.value)}
              className={`${CONTROLE} tabular-nums`}
            />
          )}
        </Field>
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--fin-accent)]"
          checked={vinculo.provisiona_13_ferias}
          onChange={(e) => set('provisiona_13_ferias', e.target.checked)}
        />
        <span>
          <span className="fin-t-body text-[var(--fin-text)]">Provisionar 13º e férias todo mês</span>
          <span className="block fin-t-caption text-[var(--fin-text-3)]">
            Rateia um salário de 13º e um salário mais um terço de férias ao longo do ano, para
            dezembro não dar salto no caixa.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="fin-t-body-strong text-[var(--fin-text)]">Benefícios</span>
          <button
            type="button"
            onClick={() => set('beneficios', [...vinculo.beneficios, { nome: '', valor: 0 }])}
            className="inline-flex h-8 items-center gap-1 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] px-2 fin-t-caption text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Adicionar
          </button>
        </div>
        {vinculo.beneficios.length === 0 ? (
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            Vale refeição, plano de saúde, transporte. Entram no custo da pessoa.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {vinculo.beneficios.map((b, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input
                  value={b.nome}
                  placeholder="Nome do benefício"
                  onChange={(e) => mexerBeneficio(i, 'nome', e.target.value)}
                  className={CONTROLE}
                  aria-label={`Nome do benefício ${i + 1}`}
                />
                <Input
                  type="number"
                  min={0}
                  step={10}
                  inputMode="decimal"
                  value={b.valor}
                  onChange={(e) => mexerBeneficio(i, 'valor', Number(e.target.value) || 0)}
                  className={`${CONTROLE} w-32 text-right tabular-nums`}
                  aria-label={`Valor do benefício ${i + 1}`}
                />
                <button
                  type="button"
                  onClick={() => set('beneficios', vinculo.beneficios.filter((_, j) => j !== i))}
                  className="rounded p-1.5 text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-negative-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
                  aria-label={`Remover benefício ${b.nome || i + 1}`}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Custo montado na frente de quem digita: a conta não é salário. */}
      <div className="rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] p-3">
        <p className="fin-t-overline text-[var(--fin-text-3)]">Custo mensal desta pessoa</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Money valor={custo.total} size="metricSm" />
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            salário {custo.salario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            {custo.beneficios > 0 && ` · benefícios ${custo.beneficios.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
            {custo.encargos > 0 && ` · encargos ${custo.encargos.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
            {custo.provisoes > 0 && ` · 13º e férias ${custo.provisoes.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <ConfirmDialog
      aberto={aberto}
      onOpenChange={(proximo) => { if (!proximo) onFechar(); }}
      titulo={`Vínculo de ${nome}`}
      oQueVaiAcontecer="Define quanto esta pessoa custa por mês. O valor entra na folha e na relação folha sobre faturamento."
      previa={previa}
      confirmarRotulo="Salvar vínculo"
      processando={salvando}
      onConfirmar={onConfirmar}
    />
  );
}

export default DialogVinculo;
