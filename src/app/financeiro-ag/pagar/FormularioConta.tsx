'use client';

import type { ReactNode } from 'react';

import Link from 'next/link';

import type { CartaoCorporativo, ContaPagar, NaturezaCusto, PlanoContas } from '@/lib/crm-types';
import { CampoCambio } from '@/components/fin/CampoCambio';
import { Field } from '@/components/fin/Field';
import { MoneyField } from '@/components/fin/MoneyField';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { FormSection } from '@/components/financeiro/FormSection';
import { Input } from '@/components/ui/input';
import { paraBRL } from '@/lib/money';
import { formatarNaMoeda } from '@/lib/cambio';
import {
  AvisoDeDiaNaoUtil, CampoContaPrevista, CampoMoeda, CampoSoLeitura, FaixaDaVenda, type ContaParaPrevisao,
} from '@/components/financeiro/CamposDoLancamento';
import { CamposPersonalizadosDoTitulo } from '@/components/fin/CamposPersonalizadosDoTitulo';
import { HistoricoRecolhivel } from '@/components/fin/HistoricoDoRegistro';
import { cn } from '@/lib/utils';
import { Money } from '@/components/fin/Money';
import { BlocoDeRepeticao } from '@/components/financeiro/recorrencia/BlocoDeRepeticao';
import { SecaoRateios } from '@/components/financeiro/SecaoRateios';
import { LerBoletoOuNota } from '@/components/financeiro/LerBoletoOuNota';
import { CampoLinhaDigitavel } from '@/components/financeiro/CampoLinhaDigitavel';
import { useFormasDePagamento } from '@/components/fin/useFormasDePagamento';
import { detalheDaForma, formaDoValor, opcoesDeForma } from '@/lib/formas-pagamento';

import { CampoSelecao, CONTROLE, Interruptor, type OpcaoDeSelecao } from './campos';
import type { ErrosDoFormulario, FormState } from './tipos';
import { DetalhesDaLeitura } from './DetalhesDaLeitura';
import { descartarLeitura, esquecerOrigem, trocarLeitura, usarDoBoleto } from './leitura';

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

const OPCOES_NATUREZA: OpcaoDeSelecao[] = [
  { valor: NENHUM, rotulo: 'Sem classificação' },
  { valor: 'FIXO', rotulo: 'Fixo' },
  { valor: 'VARIAVEL', rotulo: 'Variável' },
  { valor: 'COMPRA_UNICA', rotulo: 'Compra única' },
];

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
  /** Conteúdo extra no fim da janela (ex.: histórico de baixas da conta em edição). */
  extra?: ReactNode;
  /** Ao editar uma conta que se repete: a faixa com a regra (05/11/2026). */
  faixaDaSerie?: ReactNode;
  /** Ao editar: abre "Mais parcelas" (null quando a conta não aceita). */
  onMaisParcelas?: (() => void) | null;
  /** Contas bancárias e a padrão da agência, para a conta prevista (06/11/2026). */
  contasPrevisao?: readonly ContaParaPrevisao[];
  padraoPrevisaoId?: string | null;
  /** Conta que nasceu de uma venda: pessoa, valor e vencimento só mudam por ela. */
  vendaId?: string | null;
  /** Id da conta em edição (histórico). */
  tituloId?: string | null;
};

function dataBR(iso: string): string {
  const [a, m, d] = String(iso || '').slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : 'Sem vencimento';
}

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
  extra,
  faixaDaSerie,
  onMaisParcelas,
  contasPrevisao = [],
  padraoPrevisaoId = null,
  vendaId = null,
  tituloId = null,
}: FormularioContaProps) {
  const travada = Boolean(editando && vendaId);
  const cartoesAtivos = cartoes.filter((c) => c.ativo);
  const estrangeira = form.moeda !== 'BRL';
  const repetindo = !editando && form.repeticao.ativa;

  const opcoesCategoria: OpcaoDeSelecao[] = [
    { valor: NENHUM, rotulo: 'Sem categoria' },
    ...despesaContas.map((c) => ({ valor: c.id, rotulo: `${c.codigo} · ${c.nome}` })),
  ];

  // Formas do cadastro (05/11/2026). O valor que a conta já tem sempre
  // aparece, mesmo antigo ("Depósito") ou desligado: salvar sem mexer não troca.
  const formasDaAgencia = useFormasDePagamento();
  const opcoesForma: OpcaoDeSelecao[] = [
    { valor: NENHUM, rotulo: 'Ainda não sei' },
    ...opcoesDeForma(formasDaAgencia, 'pagar', form.forma_pagamento).map((o) => ({ valor: o.valor, rotulo: o.rotulo })),
  ];
  const formaEscolhida = formaDoValor(form.forma_pagamento, formasDaAgencia);
  const ajudaDaForma = formaEscolhida ? detalheDaForma(formaEscolhida) || undefined : undefined;

  const opcoesCartao: OpcaoDeSelecao[] = [
    { valor: NENHUM, rotulo: 'Escolha o cartão' },
    ...cartoesAtivos.map((c) => ({
      valor: c.id,
      rotulo: `${c.apelido}${c.ultimos_digitos ? ` •••• ${c.ultimos_digitos}` : ''}`,
    })),
  ];

  const origens = form.leitura?.origens ?? {};
  const mostrarLinha = form.forma_pagamento === 'BOLETO' || form.linha_digitavel !== '';
  const mostrarPix = form.forma_pagamento === 'PIX' || form.chave_pix !== '';

  const sujo =
    !editando &&
    (form.leitura !== null ||
      form.fornecedor_nome.trim() !== '' ||
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
          {form.repeticao.modo === 'parcelado'
            ? 'O valor é dividido nas parcelas da prévia. Cada parcela pode ser paga ou editada separadamente.'
            : 'As contas da prévia são criadas juntas. Cada uma pode ser paga ou editada separadamente.'}
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
          ? 'Altere os dados desta conta.'
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
      acaoSecundaria={editando && onMaisParcelas ? { rotulo: 'Mais parcelas', onClick: onMaisParcelas } : null}
    >
      <div className="flex flex-col gap-4">
        {editando && faixaDaSerie ? faixaDaSerie : null}
        {travada && vendaId ? <FaixaDaVenda vendaId={vendaId} /> : null}
        {!editando ? (
          <LerBoletoOuNota
            resposta={form.leitura?.resposta ?? null}
            desabilitado={salvando}
            onLido={(r) => {
              // Vazia, ou preenchida pela leitura anterior (que a troca limpa).
              const categoriaVazia = !form.categoria_id || Boolean(form.leitura?.origens.categoria);
              onForm((f) => trocarLeitura(f, r));
              // Natureza e "custo comercial" vêm da categoria, como na escolha à mão.
              const sugerida = r.sugestoes.categorias[0];
              if (categoriaVazia && sugerida) onCategoriaChange(sugerida.id);
            }}
            onDescartar={() => onForm(descartarLeitura)}
          >
            <DetalhesDaLeitura form={form} onForm={onForm} onCategoriaChange={onCategoriaChange} />
          </LerBoletoOuNota>
        ) : null}
        <FormSection title="Essencial" description="O mínimo para a conta existir." alwaysOpen>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {travada ? (
              <CampoSoLeitura rotulo="Fornecedor">{form.fornecedor_nome || 'Sem fornecedor'}</CampoSoLeitura>
            ) : (
            <Field rotulo="Fornecedor" obrigatorio ajuda={origens.fornecedor} erro={erros.fornecedor}>
              {(a) => (
                <Input
                  {...a}
                  aria-invalid={a['aria-invalid'] || undefined}
                  value={form.fornecedor_nome}
                  placeholder="Quem recebe o pagamento"
                  autoComplete="off"
                  onChange={(e) => {
                    const v = e.target.value;
                    onForm((f) => ({ ...esquecerOrigem(f, 'fornecedor'), fornecedor_nome: v }));
                  }}
                  className={cn(CONTROLE, erros.fornecedor && 'border-[var(--fin-negative)]')}
                />
              )}
            </Field>
            )}

            <Field rotulo="Descrição" obrigatorio ajuda={origens.descricao} erro={erros.descricao}>
              {(a) => (
                <Input
                  {...a}
                  aria-invalid={a['aria-invalid'] || undefined}
                  value={form.descricao}
                  placeholder="O que está sendo pago"
                  autoComplete="off"
                  onChange={(e) => {
                    const v = e.target.value;
                    onForm((f) => ({ ...esquecerOrigem(f, 'descricao'), descricao: v }));
                  }}
                  className={cn(CONTROLE, erros.descricao && 'border-[var(--fin-negative)]')}
                />
              )}
            </Field>

            {travada ? (
              <CampoSoLeitura rotulo="Valor">{formatarNaMoeda(form.valor_original, form.moeda)}</CampoSoLeitura>
            ) : (
            <MoneyField
              rotulo="Valor"
              obrigatorio
              moeda={form.moeda}
              valor={form.valor_original}
              ajuda={origens.valor}
              erro={erros.valor}
              onChange={(v) => onForm((f) => ({ ...esquecerOrigem(f, 'valor'), valor_original: v }))}
            />
            )}

            {travada ? (
              <CampoSoLeitura rotulo="Vencimento">{dataBR(form.data_vencimento)}</CampoSoLeitura>
            ) : (
            <Field rotulo="Vencimento" obrigatorio ajuda={origens.vencimento} erro={erros.vencimento}>
              {(a) => (
                <Input
                  {...a}
                  aria-invalid={a['aria-invalid'] || undefined}
                  type="date"
                  value={form.data_vencimento}
                  onChange={(e) => {
                    const v = e.target.value;
                    onForm((f) => ({ ...esquecerOrigem(f, 'vencimento'), data_vencimento: v }));
                  }}
                  className={cn(CONTROLE, 'tabular-nums', erros.vencimento && 'border-[var(--fin-negative)]')}
                />
              )}
            </Field>
            )}

            <Field
              rotulo="Emissão"
              ajuda="Quando a conta nasceu (nota, fatura, combinado). Não pode ser depois do vencimento."
              erro={erros.emissao}
            >
              {(a) => (
                <Input
                  {...a}
                  aria-invalid={a['aria-invalid'] || undefined}
                  type="date"
                  value={form.data_emissao}
                  max={form.data_vencimento || undefined}
                  onChange={(e) => {
                    const v = e.target.value;
                    onForm((f) => ({ ...f, data_emissao: v }));
                  }}
                  className={cn(CONTROLE, 'tabular-nums', erros.emissao && 'border-[var(--fin-negative)]')}
                />
              )}
            </Field>

            <div className="sm:col-span-2">
              <AvisoDeDiaNaoUtil
                vencimento={form.data_vencimento}
                desabilitado={travada}
                onUsar={(iso) => onForm((f) => ({ ...esquecerOrigem(f, 'vencimento'), data_vencimento: iso }))}
              />
            </div>
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
              ajuda={origens.categoria ?? 'Preenche o tipo de despesa automaticamente.'}
              valor={form.categoria_id || NENHUM}
              opcoes={opcoesCategoria}
              onChange={(v) => {
                onCategoriaChange(v === NENHUM ? '' : v);
                onForm((f) => esquecerOrigem(f, 'categoria'));
              }}
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
          title="Rateios"
          description="Centro de custo da conta, divisão entre centros e tags."
          defaultOpen={form.rateio.length > 0 || Boolean(form.centro_custo_id)}
        >
          <SecaoRateios
            total={paraBRL(form.valor_original, form.moeda, form.cambio)}
            tipo="DESPESA"
            centroId={form.centro_custo_id}
            rateio={form.rateio}
            tags={form.tags}
            onChange={(alteracao) => onForm((f) => ({ ...f, ...alteracao }))}
          />
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
              opcoes={opcoesForma}
              ajuda={ajudaDaForma}
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

            <CampoMoeda
              valor={form.moeda}
              travada={editando}
              ajuda="Conta em outra moeda: informe o câmbio. A conta é registrada em reais."
              onChange={(v) => onForm((f) => ({ ...f, moeda: v as ContaPagar['moeda'], ...(v === 'BRL' ? { cambio: 1, cambio_carimbo: null } : {}) }))}
            />

            {estrangeira && travada ? (
              <CampoSoLeitura rotulo="Câmbio">{String(form.cambio).replace('.', ',')}</CampoSoLeitura>
            ) : estrangeira ? (
              <CampoCambio
                moeda={form.moeda}
                valor={form.cambio}
                carimbo={form.cambio_carimbo}
                obrigatorio
                erro={erros.cambio}
                onChange={(cambio, carimbo) => onForm((f) => ({ ...f, cambio, cambio_carimbo: carimbo }))}
              />
            ) : null}

            <CampoContaPrevista
              valor={form.conta_previsao_id}
              onChange={(id) => onForm((f) => ({ ...f, conta_previsao_id: id }))}
              contas={contasPrevisao}
              padraoId={padraoPrevisaoId}
              verbo="pagar"
            />

            <Field rotulo="Número do documento" ajuda="Da nota, da fatura ou do boleto.">
              {(a) => (
                <Input
                  {...a}
                  aria-invalid={a['aria-invalid'] || undefined}
                  value={form.numero_documento}
                  autoComplete="off"
                  onChange={(e) => {
                    const v = e.target.value;
                    onForm((f) => ({ ...f, numero_documento: v }));
                  }}
                  className={CONTROLE}
                />
              )}
            </Field>

            {mostrarLinha ? (
              <CampoLinhaDigitavel
                className="sm:col-span-2"
                controle={CONTROLE}
                valor={form.linha_digitavel}
                onChange={(d) => onForm((f) => ({ ...f, linha_digitavel: d }))}
                valorAtual={form.valor_original}
                vencimentoAtual={form.data_vencimento}
                onUsarDoBoleto={(dados) => onForm((f) => usarDoBoleto(f, dados))}
              />
            ) : null}

            {mostrarPix ? (
              <div className="sm:col-span-2">
                <Field rotulo="Chave Pix" ajuda="A chave ou o código Pix copia e cola para pagar.">
                  {(a) => (
                    <Input
                      {...a}
                      aria-invalid={a['aria-invalid'] || undefined}
                      value={form.chave_pix}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => {
                        const v = e.target.value;
                        onForm((f) => ({ ...f, chave_pix: v }));
                      }}
                      className={CONTROLE}
                    />
                  )}
                </Field>
              </div>
            ) : null}

            {editando && form.anexos.length > 0 ? (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <span className="fin-t-body-strong text-[var(--fin-text)]">Anexos</span>
                <ul className="flex flex-col gap-1">
                  {form.anexos.map((anexo) => (
                    <li key={anexo.url} className="fin-t-caption">
                      <a
                        href={anexo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn('rounded-[var(--fin-r-sm)] text-[var(--fin-accent)] underline underline-offset-2 break-all', FOCO_LINK)}
                      >
                        {anexo.nome}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
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

            {!editando ? (
              <div className="sm:col-span-2">
                <BlocoDeRepeticao
                  estado={form.repeticao}
                  onChange={(patch) => onForm((f) => ({ ...f, repeticao: { ...f.repeticao, ...patch } }))}
                  inicio={form.data_vencimento}
                  valor={form.valor_original}
                  moeda={form.moeda}
                  substantivo="conta a pagar"
                />
              </div>
            ) : null}
          </div>
        </FormSection>

        <CamposPersonalizadosDoTitulo
          tabela="contas_pagar"
          valores={form.campos_personalizados ?? {}}
          onChange={(valores) => onForm((f) => ({ ...f, campos_personalizados: valores }))}
        />
      </div>
      {extra}
      {editando && tituloId ? <HistoricoRecolhivel entidade="contas_pagar" id={tituloId} /> : null}
    </RecordSheet>
  );
}

export default FormularioConta;
