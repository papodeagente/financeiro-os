'use client';

import type { ReactNode } from 'react';

import { ContaReceber } from '@/lib/crm-types';
import type { CarimboDoCambio } from '@/lib/cambio';
import { formatarNaMoeda } from '@/lib/cambio';
import { paraBRL } from '@/lib/money';
import { CampoCambio } from '@/components/fin/CampoCambio';
import { Money } from '@/components/fin/Money';
import { CamposPersonalizadosDoTitulo } from '@/components/fin/CamposPersonalizadosDoTitulo';
import {
  AvisoDeDiaNaoUtil, CampoContaPrevista, CampoMoeda, CampoSoLeitura, FaixaDaVenda, type ContaParaPrevisao,
} from '@/components/financeiro/CamposDoLancamento';
import { percentualDaTaxa } from '@/lib/taxa-plataforma';
import { Field } from '@/components/fin/Field';
import { MoneyField } from '@/components/fin/MoneyField';
import { FormSection } from '@/components/financeiro/FormSection';
import { Input } from '@/components/ui/input';
import { ClientePicker } from '@/components/ClientePicker';
import { SeletorDePlataforma } from './SeletorDePlataforma';
import { SecaoRateios } from '@/components/financeiro/SecaoRateios';
import { useFormasDePagamento } from '@/components/fin/useFormasDePagamento';
import { detalheDaForma, formaDoValor, opcoesDeForma } from '@/lib/formas-pagamento';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Apresentação do formulário de conta a receber. Não decide nada:
 * recebe o estado, devolve alterações. Os nomes de campo são os mesmos
 * que vão para o servidor.
 */
export type FormState = Omit<ContaReceber,
  'id' | 'juros' | 'multa' | 'desconto' | 'valor_final' | 'data_emissao' |
  'data_recebimento' | 'valor_recebido' | 'conta_bancaria_id' |
  'boleto_emitido' | 'boleto_codigo' | 'boleto_url' | 'status' |
  'anexos' | 'venda_id' | 'grupo_id'
> & {
  /** Emissão (06/11/2026, E7): editável, nunca depois do vencimento. */
  data_emissao: string;
  /** Conta bancária onde se espera receber. Vazia = a padrão da agência. */
  conta_previsao_id: string;
  /** Campos que a agência criou para os títulos. */
  campos_personalizados: Record<string, unknown>;
  /** Receber em moeda estrangeira: valor_original na moeda, valor_final em reais. */
  moeda: string;
  cambio: number;
  cambio_carimbo: CarimboDoCambio | null;
};

export const EMPTY_FORM: FormState = {
  origem: 'VENDA',
  // A taxa da plataforma nasce zerada: ela só é conhecida quando o dinheiro
  // passa pela adquirente, não no lançamento.
  taxa: 0,
  taxa_plataforma: '',
  // O VÍNCULO com o cadastro, que o formulário não tinha. Sem ele a emissão
  // de nota não acha o cliente (nfse-servico.ts:197 resolve por cliente_id) e
  // a prefeitura recusa por falta do documento do tomador. O nome em texto
  // livre continua sendo gravado, para a lista e para o histórico antigo.
  cliente_id: '',
  cliente_nome: '',
  descricao: '',
  categoria_id: '',
  valor_original: 0,
  data_vencimento: '',
  forma_recebimento: '',
  parcela_numero: 1,
  total_parcelas: 1,
  observacoes: '',
  // Centro, rateio e tags (05/11/2026). Centro único = rateio vazio.
  centro_custo: '',
  centro_custo_id: '',
  rateio: [],
  tags: [],
  data_emissao: '',
  conta_previsao_id: '',
  campos_personalizados: {},
  moeda: 'BRL',
  cambio: 1,
  cambio_carimbo: null,
};

/** Valor da conta em reais (a moeda estrangeira passa pelo câmbio). */
export function valorEmReais(form: Pick<FormState, 'valor_original' | 'moeda' | 'cambio'>): number {
  return paraBRL(form.valor_original, form.moeda || 'BRL', form.moeda && form.moeda !== 'BRL' ? form.cambio : 1);
}

export type CampoObrigatorio =
  | 'cliente_nome' | 'descricao' | 'valor_original' | 'data_vencimento' | 'taxa' | 'data_emissao' | 'cambio';
export type ErrosForm = Partial<Record<CampoObrigatorio, string>>;

const CONTROLE = [
  'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)]',
  'bg-[var(--fin-surface)] text-[var(--fin-text)] lg:h-10',
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0',
].join(' ');

const ORIGENS: { valor: ContaReceber['origem']; rotulo: string }[] = [
  { valor: 'VENDA', rotulo: 'Venda' },
  { valor: 'COMISSAO_FORNECEDOR', rotulo: 'Comissão de fornecedor' },
  { valor: 'FEE', rotulo: 'Taxa de serviço' },
  { valor: 'OUTROS', rotulo: 'Outros' },
];

export type FormularioContaProps = {
  form: FormState;
  erros: ErrosForm;
  onChange: (patch: Partial<FormState>) => void;
  /** Plataformas que a agência já usou, para o seletor aprender. */
  plataformasUsadas?: string[];
  /** Bloco "Repetir" (05/11/2026), só na criação. */
  repeticao?: ReactNode;
  /** Com a repetição ligada, a série numera as parcelas sozinha. */
  ocultarParcelaManual?: boolean;
  /** Editando uma conta que já existe (a moeda não muda mais). */
  editando?: boolean;
  /** Conta que nasceu de uma venda: cliente, valor e vencimento só mudam por ela. */
  vendaId?: string | null;
  /** Contas bancárias e a padrão da agência, para a conta prevista. */
  contasPrevisao?: readonly ContaParaPrevisao[];
  padraoPrevisaoId?: string | null;
};

function dataBR(iso: string): string {
  const [a, m, d] = String(iso || '').slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : 'Sem vencimento';
}

export function FormularioConta({
  form,
  erros,
  onChange,
  plataformasUsadas = [],
  repeticao,
  ocultarParcelaManual = false,
  editando = false,
  vendaId = null,
  contasPrevisao = [],
  padraoPrevisaoId = null,
}: FormularioContaProps) {
  const travada = Boolean(editando && vendaId);
  const estrangeira = Boolean(form.moeda) && form.moeda !== 'BRL';
  const emReais = valorEmReais(form);
  const rotuloOrigem = ORIGENS.find(o => o.valor === form.origem)?.rotulo ?? ORIGENS[0].rotulo;
  // As escolhas vêm do cadastro de formas de pagamento (05/11/2026). O valor
  // que a conta já tem sempre aparece, mesmo antigo ou desligado.
  const formasDaAgencia = useFormasDePagamento();
  const FORMAS = [
    { valor: '', rotulo: 'Ainda não definida' },
    ...opcoesDeForma(formasDaAgencia, 'receber', form.forma_recebimento),
  ];
  const rotuloForma = FORMAS.find(f => f.valor === form.forma_recebimento)?.rotulo ?? FORMAS[0].rotulo;
  const formaEscolhida = formaDoValor(form.forma_recebimento, formasDaAgencia);
  const ajudaDaForma = formaEscolhida ? detalheDaForma(formaEscolhida) || undefined : undefined;

  // O percentual NUNCA é gravado: é derivado do que está na tela. Sem base
  // ele é null, e a ajuda diz o que falta em vez de mostrar "0%" — que se
  // leria como "não teve taxa".
  const pctDaTaxa = percentualDaTaxa(form.taxa, emReais);
  const ajudaDaTaxa = emReais > 0
    ? (pctDaTaxa === null
        ? 'Quanto a plataforma reteve desta conta.'
        : `${pctDaTaxa.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do valor da conta. Entra no resultado e sai do saldo do banco.`)
    : 'Informe o valor da conta para ver o percentual.';

  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      {travada && vendaId ? <FaixaDaVenda vendaId={vendaId} /> : null}
      <FormSection title="Essencial" alwaysOpen>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <div className="sm:col-span-2">
            {travada ? (
              <CampoSoLeitura rotulo="Cliente">{form.cliente_nome || 'Cliente não informado'}</CampoSoLeitura>
            ) : (
            <Field
              rotulo="Cliente"
              obrigatorio
              ajuda="Escolha um cadastro. É dele que sai o CPF ou CNPJ da nota fiscal."
              erro={erros.cliente_nome ?? null}
            >
              {a => (
                <ClientePicker
                  id={a.id}
                  value={form.cliente_id}
                  nome={form.cliente_nome}
                  placeholder="Buscar quem vai pagar"
                  onChange={c =>
                    onChange({ cliente_id: c?.id ?? '', cliente_nome: c?.nome ?? '' })
                  }
                />
              )}
            </Field>
            )}
          </div>

          <div className="sm:col-span-2">
            <Field
              rotulo="Descrição"
              obrigatorio
              ajuda="O que essa cobrança representa. Aparece na lista."
              erro={erros.descricao ?? null}
            >
              {a => (
                <Input
                  {...a}
                  value={form.descricao}
                  onChange={e => onChange({ descricao: e.target.value })}
                  placeholder="Ex: pacote Buenos Aires, entrada"
                  className={CONTROLE}
                />
              )}
            </Field>
          </div>

          {travada ? (
            <CampoSoLeitura rotulo="Valor">{formatarNaMoeda(form.valor_original, form.moeda || 'BRL')}</CampoSoLeitura>
          ) : (
          <MoneyField
            rotulo="Valor"
            obrigatorio
            moeda={form.moeda || 'BRL'}
            valor={form.valor_original}
            onChange={v => onChange({ valor_original: v })}
            erro={erros.valor_original ?? null}
          />
          )}

          {travada ? (
            <CampoSoLeitura rotulo="Vencimento">{dataBR(form.data_vencimento)}</CampoSoLeitura>
          ) : (
          <Field rotulo="Vencimento" obrigatorio erro={erros.data_vencimento ?? null}>
            {a => (
              <Input
                {...a}
                type="date"
                value={form.data_vencimento}
                onChange={e => onChange({ data_vencimento: e.target.value })}
                className={CONTROLE}
              />
            )}
          </Field>
          )}

          <Field
            rotulo="Emissão"
            ajuda="Quando a conta nasceu. Não pode ser depois do vencimento."
            erro={erros.data_emissao ?? null}
          >
            {a => (
              <Input
                {...a}
                type="date"
                value={form.data_emissao}
                max={form.data_vencimento || undefined}
                onChange={e => onChange({ data_emissao: e.target.value })}
                className={CONTROLE}
              />
            )}
          </Field>

          {travada ? (
            <CampoSoLeitura rotulo="Moeda">{form.moeda || 'BRL'}</CampoSoLeitura>
          ) : (
            <CampoMoeda
              valor={form.moeda || 'BRL'}
              travada={editando}
              ajuda="Receber em outra moeda: informe o câmbio. A conta é registrada em reais."
              onChange={m => onChange(m === 'BRL' ? { moeda: 'BRL', cambio: 1, cambio_carimbo: null } : { moeda: m })}
            />
          )}

          {estrangeira ? (
            travada ? (
              <CampoSoLeitura rotulo="Câmbio">{String(form.cambio).replace('.', ',')}</CampoSoLeitura>
            ) : (
              <CampoCambio
                moeda={form.moeda}
                valor={form.cambio}
                carimbo={form.cambio_carimbo}
                lado="compra"
                obrigatorio
                erro={erros.cambio ?? null}
                onChange={(cambio, carimbo) => onChange({ cambio, cambio_carimbo: carimbo })}
              />
            )
          ) : null}

          {estrangeira ? (
            <p className="fin-t-caption flex flex-wrap items-baseline gap-x-[var(--fin-s-1)] text-[var(--fin-text-2)] sm:col-span-2">
              Em reais: <Money valor={emReais} size="caption" align="esquerda" estado="ok" />. O valor em {form.moeda} e o câmbio ficam guardados na conta.
            </p>
          ) : null}

          <div className="sm:col-span-2">
            <AvisoDeDiaNaoUtil
              vencimento={form.data_vencimento}
              desabilitado={travada}
              onUsar={iso => onChange({ data_vencimento: iso })}
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="Classificação" description="Ajuda a organizar os relatórios." defaultOpen>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <Field rotulo="Origem">
            {a => (
              <Select
                value={form.origem}
                onValueChange={v => onChange({ origem: v as ContaReceber['origem'] })}
              >
                <SelectTrigger
                  id={a.id}
                  aria-invalid={a['aria-invalid']}
                  aria-describedby={a['aria-describedby']}
                  className={CONTROLE}
                >
                  <SelectValue>{() => rotuloOrigem}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ORIGENS.map(o => (
                    <SelectItem key={o.valor} value={o.valor} className="fin-t-body">
                      {o.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field rotulo="Código da categoria" ajuda="Opcional. Use o código do seu plano de categorias.">
            {a => (
              <Input
                {...a}
                value={form.categoria_id}
                onChange={e => onChange({ categoria_id: e.target.value })}
                placeholder="Ex: 3.01"
                className={CONTROLE}
              />
            )}
          </Field>

          <div className="sm:col-span-2">
            <Field rotulo="Observações">
              {a => (
                <Input
                  {...a}
                  value={form.observacoes}
                  onChange={e => onChange({ observacoes: e.target.value })}
                  placeholder="Anotação interna"
                  className={CONTROLE}
                />
              )}
            </Field>
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Rateios"
        description="Centro de custo da conta, divisão entre centros e tags."
        defaultOpen={form.rateio.length > 0 || Boolean(form.centro_custo_id)}
      >
        <SecaoRateios
          total={emReais}
          tipo="RECEITA"
          centroId={form.centro_custo_id ?? ''}
          rateio={form.rateio}
          tags={form.tags ?? []}
          onChange={alteracao => onChange(alteracao)}
        />
      </FormSection>

      <FormSection
        title="Taxa da plataforma de pagamento"
        description="O que a adquirente retém. O cliente paga o valor cheio; só a diferença cai no banco."
        defaultOpen
      >
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <MoneyField
            rotulo="Taxa da plataforma"
            valor={form.taxa}
            onChange={v => onChange({ taxa: v })}
            maximo={emReais > 0 ? emReais : undefined}
            ajuda={ajudaDaTaxa}
            erro={erros.taxa ?? null}
          />

          <Field
            rotulo="Plataforma que reteve"
            ajuda="Agrupa o relatório de taxas. Não achou na lista? Escolha Outra."
          >
            {a => (
              <SeletorDePlataforma
                id={a.id}
                valor={form.taxa_plataforma}
                usadas={plataformasUsadas}
                onChange={v => onChange({ taxa_plataforma: v })}
              />
            )}
          </Field>
        </div>
      </FormSection>

      <FormSection title="Recebimento e parcelas" description="Como e em quantas vezes o dinheiro entra." defaultOpen={Boolean(repeticao)}>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field rotulo="Forma de recebimento" ajuda={ajudaDaForma}>
              {a => (
                <Select
                  value={form.forma_recebimento}
                  onValueChange={v => onChange({ forma_recebimento: v as ContaReceber['forma_recebimento'] })}
                >
                  <SelectTrigger
                    id={a.id}
                    aria-invalid={a['aria-invalid']}
                    aria-describedby={a['aria-describedby']}
                    className={CONTROLE}
                  >
                    <SelectValue>{() => rotuloForma}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {FORMAS.map(f => (
                      <SelectItem key={f.valor || 'INDEFINIDA'} value={f.valor} className="fin-t-body">
                        {f.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>

          <div className="sm:col-span-2">
            <CampoContaPrevista
              valor={form.conta_previsao_id}
              onChange={id => onChange({ conta_previsao_id: id })}
              contas={contasPrevisao}
              padraoId={padraoPrevisaoId}
              verbo="receber"
            />
          </div>

          {!ocultarParcelaManual ? (
            <>
          <Field rotulo="Número da parcela">
            {a => (
              <Input
                {...a}
                type="number"
                min={1}
                value={form.parcela_numero}
                onChange={e => onChange({ parcela_numero: parseInt(e.target.value) || 1 })}
                className={CONTROLE}
              />
            )}
          </Field>

          <Field rotulo="Total de parcelas">
            {a => (
              <Input
                {...a}
                type="number"
                min={1}
                value={form.total_parcelas}
                onChange={e => onChange({ total_parcelas: parseInt(e.target.value) || 1 })}
                className={CONTROLE}
              />
            )}
          </Field>
            </>
          ) : null}

          {repeticao ? <div className="sm:col-span-2">{repeticao}</div> : null}
        </div>
      </FormSection>

      <CamposPersonalizadosDoTitulo
        tabela="contas_receber"
        valores={form.campos_personalizados ?? {}}
        onChange={valores => onChange({ campos_personalizados: valores })}
      />
    </div>
  );
}

export default FormularioConta;
