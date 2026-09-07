'use client';

import { ContaReceber } from '@/lib/crm-types';
import { Field } from '@/components/fin/Field';
import { MoneyField } from '@/components/fin/MoneyField';
import { FormSection } from '@/components/financeiro/FormSection';
import { Input } from '@/components/ui/input';
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
  'rateio' | 'anexos' | 'venda_id' | 'grupo_id' | 'cliente_id' | 'centro_custo'
>;

export const EMPTY_FORM: FormState = {
  origem: 'VENDA',
  cliente_nome: '',
  descricao: '',
  categoria_id: '',
  valor_original: 0,
  data_vencimento: '',
  forma_recebimento: '',
  parcela_numero: 1,
  total_parcelas: 1,
  observacoes: '',
};

export type CampoObrigatorio = 'cliente_nome' | 'descricao' | 'valor_original' | 'data_vencimento';
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

const FORMAS: { valor: ContaReceber['forma_recebimento']; rotulo: string }[] = [
  { valor: '', rotulo: 'Ainda não definida' },
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'TED', rotulo: 'Transferência' },
  { valor: 'CARTAO', rotulo: 'Cartão' },
  { valor: 'BOLETO', rotulo: 'Boleto' },
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
  { valor: 'CHEQUE', rotulo: 'Cheque' },
];

export type FormularioContaProps = {
  form: FormState;
  erros: ErrosForm;
  onChange: (patch: Partial<FormState>) => void;
};

export function FormularioConta({ form, erros, onChange }: FormularioContaProps) {
  const rotuloOrigem = ORIGENS.find(o => o.valor === form.origem)?.rotulo ?? ORIGENS[0].rotulo;
  const rotuloForma = FORMAS.find(f => f.valor === form.forma_recebimento)?.rotulo ?? FORMAS[0].rotulo;

  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      <FormSection title="Essencial" alwaysOpen>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field rotulo="Cliente" obrigatorio erro={erros.cliente_nome ?? null}>
              {a => (
                <Input
                  {...a}
                  value={form.cliente_nome}
                  onChange={e => onChange({ cliente_nome: e.target.value })}
                  placeholder="Nome de quem vai pagar"
                  className={CONTROLE}
                />
              )}
            </Field>
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

          <MoneyField
            rotulo="Valor"
            obrigatorio
            valor={form.valor_original}
            onChange={v => onChange({ valor_original: v })}
            erro={erros.valor_original ?? null}
          />

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

      <FormSection title="Recebimento e parcelas" description="Como e em quantas vezes o dinheiro entra.">
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field rotulo="Forma de recebimento">
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
        </div>
      </FormSection>
    </div>
  );
}

export default FormularioConta;
