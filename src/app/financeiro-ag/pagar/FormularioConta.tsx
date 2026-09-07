'use client';

import Link from 'next/link';

import type { CartaoCorporativo, ContaPagar, NaturezaCusto, PlanoContas } from '@/lib/crm-types';
import { Field } from '@/components/fin/Field';
import { MoneyField } from '@/components/fin/MoneyField';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { FormSection } from '@/components/financeiro/FormSection';
import { Input } from '@/components/ui/input';
import { paraBRL } from '@/lib/money';
import { cn, formatDate } from '@/lib/utils';
import { Money } from '@/components/fin/Money';

import { CampoSelecao, CONTROLE, Interruptor, type OpcaoDeSelecao } from './campos';
import type { ErrosDoFormulario, FormState, RecorrenciaPeriodo } from './tipos';

/** Sentinela de "nada escolhido". Nunca é gravada: vira '' ou null no estado. */
const NENHUM = '__NENHUM__';

const FOCO_LINK =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2';

const OPCOES_ORIGEM: OpcaoDeSelecao[] = [
  { valor: 'VENDA', rotulo: 'Venda' },
  { valor: 'GRUPO', rotulo: 'Grupo' },
  { valor: 'DESPESA_FIXA', rotulo: 'Despesa fixa' },
  { valor: 'OUTROS', rotulo: 'Outros' },
];

const OPCOES_FORMA: OpcaoDeSelecao[] = [
  { valor: NENHUM, rotulo: 'Ainda não sei' },
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'TED', rotulo: 'TED' },
  { valor: 'CARTAO_CORP', rotulo: 'Cartão corporativo' },
  { valor: 'BOLETO', rotulo: 'Boleto' },
  { valor: 'DEPOSITO', rotulo: 'Depósito' },
];

const OPCOES_MOEDA: OpcaoDeSelecao[] = [
  { valor: 'BRL', rotulo: 'Real (BRL)' },
  { valor: 'USD', rotulo: 'Dólar (USD)' },
  { valor: 'EUR', rotulo: 'Euro (EUR)' },
];

const OPCOES_NATUREZA: OpcaoDeSelecao[] = [
  { valor: NENHUM, rotulo: 'Sem classificação' },
  { valor: 'FIXO', rotulo: 'Fixo' },
  { valor: 'VARIAVEL', rotulo: 'Variável' },
  { valor: 'COMPRA_UNICA', rotulo: 'Compra única' },
];

const OPCOES_PERIODICIDADE: OpcaoDeSelecao[] = [
  { valor: 'MENSAL', rotulo: 'Todo mês, no mesmo dia' },
  { valor: 'QUINZENAL', rotulo: 'A cada 14 dias' },
  { valor: 'SEMANAL', rotulo: 'A cada 7 dias' },
];

const PASSO_DA_REPETICAO: Record<RecorrenciaPeriodo, string> = {
  MENSAL: 'mês a mês',
  QUINZENAL: 'a cada 15 dias',
  SEMANAL: 'a cada 7 dias',
};

export type FormularioContaProps = {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  editando: boolean;
  form: FormState;
  onForm: (atualiza: (f: FormState) => FormState) => void;
  onCategoriaChange: (categoriaId: string) => void;
  despesaContas: PlanoContas[];
  cartoes: CartaoCorporativo[];
  erros: ErrosDoFormulario;
  salvando: boolean;
  onSalvar: () => void;
};

export function FormularioConta({
  aberto,
  onOpenChange,
  editando,
  form,
  onForm,
  onCategoriaChange,
  despesaContas,
  cartoes,
  erros,
  salvando,
  onSalvar,
}: FormularioContaProps) {
  const cartoesAtivos = cartoes.filter((c) => c.ativo);
  const estrangeira = form.moeda !== 'BRL';
  const repetindo = form.origem === 'DESPESA_FIXA' && !editando && form.recorrencia_ativa;
  const quantas = Math.max(1, form.recorrencia_repeticoes);

  const opcoesCategoria: OpcaoDeSelecao[] = [
    { valor: NENHUM, rotulo: 'Sem categoria' },
    ...despesaContas.map((c) => ({ valor: c.id, rotulo: `${c.codigo} · ${c.nome}` })),
  ];

  const opcoesCartao: OpcaoDeSelecao[] = [
    { valor: NENHUM, rotulo: 'Escolha o cartão' },
    ...cartoesAtivos.map((c) => ({
      valor: c.id,
      rotulo: `${c.apelido}${c.ultimos_digitos ? ` •••• ${c.ultimos_digitos}` : ''}`,
    })),
  ];

  const sujo =
    !editando &&
    (form.fornecedor_nome.trim() !== '' ||
      form.descricao.trim() !== '' ||
      form.valor_original > 0 ||
      form.data_vencimento !== '');

  const resumo = (
    <span className="flex flex-col gap-1">
      {estrangeira ? (
        <span className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3">
            <span>Valor em reais</span>
            <Money
              valor={paraBRL(form.valor_original, form.moeda, form.cambio)}
              size="strong"
              estado="ok"
            />
          </span>
          <span>
            A conta é registrada em reais. O valor original em {form.moeda} continua guardado na
            ficha, junto com o câmbio informado.
          </span>
        </span>
      ) : null}
      {repetindo ? (
        <span>
          Vão ser criadas{' '}
          <span className="fin-t-body-strong text-[var(--fin-text)]">{quantas} contas a pagar</span>{' '}
          a partir de{' '}
          {form.data_vencimento ? formatDate(form.data_vencimento) : 'a data que você escolher'},
          avançando {PASSO_DA_REPETICAO[form.recorrencia_periodo]}. Cada parcela pode ser paga ou
          editada separadamente.
        </span>
      ) : null}
      {!estrangeira && !repetindo ? (
        <span>
          A conta nasce em aberto. O saldo do caixa só muda quando você registrar o pagamento.
        </span>
      ) : null}
    </span>
  );

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={onOpenChange}
      titulo={editando ? 'Editar conta a pagar' : 'Nova conta a pagar'}
      descricao={
        editando
          ? 'Altere os dados desta conta. A repetição automática só existe na criação.'
          : 'Lance uma conta que a agência precisa pagar.'
      }
      largura={640}
      sujo={sujo}
      resumo={resumo}
      acaoPrimaria={{
        rotulo: editando ? 'Salvar alterações' : 'Criar conta',
        onClick: onSalvar,
        carregando: salvando,
      }}
    >
      <div className="flex flex-col gap-4">
        <FormSection title="Essencial" description="O mínimo para a conta existir." alwaysOpen>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field rotulo="Fornecedor" obrigatorio erro={erros.fornecedor}>
              {(a) => (
                <Input
                  {...a}
                  aria-invalid={a['aria-invalid'] || undefined}
                  value={form.fornecedor_nome}
                  placeholder="Quem recebe o pagamento"
                  autoComplete="off"
                  onChange={(e) => onForm((f) => ({ ...f, fornecedor_nome: e.target.value }))}
                  className={cn(CONTROLE, erros.fornecedor && 'border-[var(--fin-negative)]')}
                />
              )}
            </Field>

            <Field rotulo="Descrição" obrigatorio erro={erros.descricao}>
              {(a) => (
                <Input
                  {...a}
                  aria-invalid={a['aria-invalid'] || undefined}
                  value={form.descricao}
                  placeholder="O que está sendo pago"
                  autoComplete="off"
                  onChange={(e) => onForm((f) => ({ ...f, descricao: e.target.value }))}
                  className={cn(CONTROLE, erros.descricao && 'border-[var(--fin-negative)]')}
                />
              )}
            </Field>

            <MoneyField
              rotulo="Valor"
              obrigatorio
              moeda={form.moeda}
              valor={form.valor_original}
              erro={erros.valor}
              onChange={(v) => onForm((f) => ({ ...f, valor_original: v }))}
            />

            <Field rotulo="Vencimento" obrigatorio erro={erros.vencimento}>
              {(a) => (
                <Input
                  {...a}
                  aria-invalid={a['aria-invalid'] || undefined}
                  type="date"
                  value={form.data_vencimento}
                  onChange={(e) => onForm((f) => ({ ...f, data_vencimento: e.target.value }))}
                  className={cn(CONTROLE, 'tabular-nums', erros.vencimento && 'border-[var(--fin-negative)]')}
                />
              )}
            </Field>
          </div>
        </FormSection>

        <FormSection
          title="Classificação"
          description="Define onde a despesa entra nos relatórios."
          defaultOpen
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoSelecao
              rotulo="Categoria"
              ajuda="Preenche o tipo de despesa automaticamente."
              valor={form.categoria_id || NENHUM}
              opcoes={opcoesCategoria}
              onChange={(v) => onCategoriaChange(v === NENHUM ? '' : v)}
            />

            <CampoSelecao
              rotulo="Tipo de despesa"
              ajuda="Fixo, variável ou compra única. Também chamado de natureza do custo."
              valor={form.natureza_custo ?? NENHUM}
              opcoes={OPCOES_NATUREZA}
              onChange={(v) =>
                onForm((f) => ({
                  ...f,
                  natureza_custo: (v === NENHUM ? null : v) as NaturezaCusto | null,
                }))
              }
            />

            <div className="sm:col-span-2">
              <Interruptor
                rotulo="Custo para conseguir cliente"
                descricao="Marketing, anúncios e comissões de aquisição. Entra no cálculo do CAC."
                ligado={form.is_custo_comercial}
                onChange={(v) => onForm((f) => ({ ...f, is_custo_comercial: v }))}
              />
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Pagamento e repetição"
          description="Como a conta vai ser paga e se ela se repete."
          defaultOpen
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoSelecao
              rotulo="Origem do lançamento"
              valor={form.origem}
              opcoes={OPCOES_ORIGEM}
              onChange={(v) => onForm((f) => ({ ...f, origem: v as ContaPagar['origem'] }))}
            />

            <CampoSelecao
              rotulo="Forma de pagamento"
              valor={form.forma_pagamento || NENHUM}
              opcoes={OPCOES_FORMA}
              onChange={(v) =>
                onForm((f) => ({
                  ...f,
                  forma_pagamento: (v === NENHUM ? '' : v) as ContaPagar['forma_pagamento'],
                }))
              }
            />

            {form.forma_pagamento === 'CARTAO_CORP' ? (
              cartoesAtivos.length === 0 ? (
                <div className="flex flex-col gap-1">
                  <span className="fin-t-body-strong text-[var(--fin-text)]">Cartão usado</span>
                  <p className="fin-t-caption text-[var(--fin-text-3)]">
                    Nenhum cartão ativo cadastrado.{' '}
                    <Link
                      href="/financeiro-ag/cartoes"
                      className={cn(
                        'rounded-[var(--fin-r-sm)] text-[var(--fin-accent)] underline underline-offset-2',
                        FOCO_LINK,
                      )}
                    >
                      Cadastrar um cartão
                    </Link>
                  </p>
                </div>
              ) : (
                <CampoSelecao
                  rotulo="Cartão usado"
                  valor={form.cartao_id || NENHUM}
                  opcoes={opcoesCartao}
                  onChange={(v) => onForm((f) => ({ ...f, cartao_id: v === NENHUM ? '' : v }))}
                />
              )
            ) : null}

            <CampoSelecao
              rotulo="Moeda"
              valor={form.moeda}
              opcoes={OPCOES_MOEDA}
              onChange={(v) => onForm((f) => ({ ...f, moeda: v as ContaPagar['moeda'] }))}
            />

            {estrangeira ? (
              <Field
                rotulo="Câmbio"
                obrigatorio
                ajuda="Quantos reais vale uma unidade da moeda escolhida."
                erro={erros.cambio}
              >
                {(a) => (
                  <Input
                    {...a}
                    aria-invalid={a['aria-invalid'] || undefined}
                    type="number"
                    min={0}
                    step="0.0001"
                    value={form.cambio}
                    onChange={(e) =>
                      onForm((f) => ({ ...f, cambio: parseFloat(e.target.value) || 1 }))
                    }
                    className={cn(CONTROLE, 'tabular-nums', erros.cambio && 'border-[var(--fin-negative)]')}
                  />
                )}
              </Field>
            ) : null}

            <div className="sm:col-span-2">
              <Field rotulo="Observações" ajuda="Fica visível na ficha da conta.">
                {(a) => (
                  <Input
                    {...a}
                    aria-invalid={a['aria-invalid'] || undefined}
                    value={form.observacoes}
                    placeholder="Alguma informação que ajude depois"
                    autoComplete="off"
                    onChange={(e) => onForm((f) => ({ ...f, observacoes: e.target.value }))}
                    className={CONTROLE}
                  />
                )}
              </Field>
            </div>

            {form.origem === 'DESPESA_FIXA' && !editando ? (
              <div className="flex flex-col gap-3 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] p-3 sm:col-span-2">
                <Interruptor
                  rotulo="Repetir esta despesa automaticamente"
                  descricao="Cria as parcelas seguintes já com o vencimento avançado."
                  ligado={form.recorrencia_ativa}
                  onChange={(v) => onForm((f) => ({ ...f, recorrencia_ativa: v }))}
                />

                {form.recorrencia_ativa ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <CampoSelecao
                      rotulo="Periodicidade"
                      valor={form.recorrencia_periodo}
                      opcoes={OPCOES_PERIODICIDADE}
                      onChange={(v) =>
                        onForm((f) => ({ ...f, recorrencia_periodo: v as RecorrenciaPeriodo }))
                      }
                    />
                    <Field rotulo="Quantidade de parcelas">
                      {(a) => (
                        <Input
                          {...a}
                          aria-invalid={a['aria-invalid'] || undefined}
                          type="number"
                          min={1}
                          max={120}
                          value={form.recorrencia_repeticoes}
                          onChange={(e) =>
                            onForm((f) => ({
                              ...f,
                              recorrencia_repeticoes: Math.max(1, parseInt(e.target.value) || 1),
                            }))
                          }
                          className={cn(CONTROLE, 'tabular-nums')}
                        />
                      )}
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </FormSection>
      </div>
    </RecordSheet>
  );
}

export default FormularioConta;
