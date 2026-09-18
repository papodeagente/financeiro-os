'use client';

/**
 * O corpo do formulário de emissão, no desenho pedido pelo Bruno em 18/09/2026
 * (o mesmo do Asaas).
 *
 * A ordem é a da decisão: o que a prefeitura exige fica em cima e cabe numa
 * tela; o que quase ninguém usa fica em blocos recolhidos marcados
 * "(Opcional)". Ver src/lib/nfse-formulario.ts para as regras.
 *
 * Uma coisa daqui NÃO existe no modelo copiado, e é de propósito: o bloco
 * "Como a agência entra nesta venda". Numa agência de viagens o valor da venda
 * não é receita da agência, e emitir nota do valor cheio de um pacote
 * agenciado faz a empresa pagar ISS sobre repasse. Nenhum formulário genérico
 * pergunta isso, e é a pergunta que mais custa dinheiro nesta tela.
 */
import { AlertTriangle, Info, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { BlocoRecolhivel } from '@/components/fin/BlocoRecolhivel';
import { formatBRL } from '@/lib/utils';
import { num } from '@/lib/money';
import {
  problemaDoCampo,
  type BlocoDoFormulario,
  type Disponibilidade,
  type FormularioNota,
  type ProblemaDoCampo,
  type ServicoCadastrado,
  type ValoresDaNota,
} from '@/lib/nfse-formulario';

const CAMPO =
  'h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)]';

function Erro({ p }: { p: ProblemaDoCampo | null }) {
  if (!p) return null;
  const cor = p.nivel === 'erro' ? 'text-[var(--fin-negative)]' : 'text-[var(--fin-warning-text)]';
  return <p className={`fin-t-caption ${cor}`}>{p.mensagem}</p>;
}

/** Rótulo com o "i" de ajuda, como no modelo. */
function Rotulo({ children, ajuda, htmlFor }: { children: React.ReactNode; ajuda?: string; htmlFor?: string }) {
  return (
    <Label htmlFor={htmlFor} className="flex items-center gap-1.5">
      {children}
      {ajuda ? (
        <span title={ajuda} className="inline-flex text-[var(--fin-text-3)]">
          <Info aria-hidden="true" className="size-3.5" />
          <span className="sr-only">{ajuda}</span>
        </span>
      ) : null}
    </Label>
  );
}

/** Campo de percentual com o "%" colado, e o valor calculado ao lado. */
function ParDeRetencao({
  rotulo, ajuda, id, aliquota, onAliquota, valor,
}: {
  rotulo: string;
  ajuda?: string;
  id: string;
  aliquota: number;
  onAliquota: (v: number) => void;
  valor: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Rotulo htmlFor={id} ajuda={ajuda}>{`Alíquota ${rotulo}`}</Rotulo>
        <div className="flex items-stretch">
          <span className="flex items-center rounded-l-[var(--fin-r-md)] border border-r-0 border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)] px-3 fin-t-body text-[var(--fin-text-3)]">
            %
          </span>
          <input
            id={id}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className={`${CAMPO} rounded-l-none`}
            value={aliquota || ''}
            placeholder="0,00"
            onChange={e => onAliquota(num(e.target.value))}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {/* O valor é CALCULADO, nunca digitado: dois campos independentes para
            a mesma retenção acabariam discordando, e o que vale é a conta. */}
        <Label>{`Valor ${rotulo}`}</Label>
        <div className="flex items-stretch">
          <span className="flex items-center rounded-l-[var(--fin-r-md)] border border-r-0 border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)] px-3 fin-t-body text-[var(--fin-text-3)]">
            R$
          </span>
          <output
            className={`${CAMPO} flex items-center rounded-l-none bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]`}
          >
            {formatBRL(valor).replace('R$', '').trim()}
          </output>
        </div>
      </div>
    </div>
  );
}

/**
 * O que aparece no lugar de um bloco que o emissor não transmite.
 *
 * Não é um aviso ao lado de campos editáveis: é o conteúdo do bloco. Campo
 * aberto que não viaja transfere para o usuário um risco que ele não enxerga.
 */
function BlocoFechado({ motivo }: { motivo: string }) {
  return (
    <div className="rounded-[var(--fin-r-md)] border border-dashed border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)] p-3">
      <p className="fin-t-caption text-[var(--fin-text-2)]">{motivo}</p>
      <a href="/config/fiscal" className="fin-t-caption text-[var(--fin-accent)] underline">
        Ver configuração de notas fiscais
      </a>
    </div>
  );
}

export function CamposDaNota({
  form, onForm, valores, problemas, servicos, listaNacional, issEhEstimativa, naoViajam,
  disponibilidade,
}: {
  form: FormularioNota;
  onForm: (f: FormularioNota) => void;
  valores: ValoresDaNota;
  problemas: ProblemaDoCampo[];
  /** Serviços cadastrados pela empresa em Configurações. */
  servicos: ServicoCadastrado[];
  /** A lista nacional, para quem ainda não cadastrou nada. */
  listaNacional: Array<{ codigo: string; cnae: string; titulo: string }>;
  issEhEstimativa: boolean;
  naoViajam: string[];
  disponibilidade: Record<BlocoDoFormulario, Disponibilidade>;
}) {
  const set = <K extends keyof FormularioNota>(k: K, v: FormularioNota[K]) =>
    onForm({ ...form, [k]: v });

  const valorDoServico = form.servico_id || form.codigo_tributacao;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h3 className="fin-t-subhead text-[var(--fin-text)]">Alíquota do serviço</h3>

        {/* ── Serviço ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <Rotulo htmlFor="nf-servico">Serviço</Rotulo>
          <select
            id="nf-servico"
            className={`${CAMPO} ${problemaDoCampo(problemas, 'servico_id') ? 'border-[var(--fin-negative)]' : ''}`}
            value={valorDoServico}
            onChange={e => {
              const v = e.target.value;
              const cad = servicos.find(s => s.id === v);
              if (cad) {
                onForm({
                  ...form,
                  servico_id: cad.id,
                  codigo_tributacao: cad.codigo_tributacao,
                  cnae: cad.cnae,
                  nbs: form.nbs || cad.nbs || '',
                  descricao: form.descricao || cad.descricao_padrao || cad.descricao || '',
                  aliquota_iss: cad.aliquota_iss > 0 ? cad.aliquota_iss : form.aliquota_iss,
                });
                return;
              }
              const nac = listaNacional.find(s => s.codigo === v);
              onForm({
                ...form,
                servico_id: '',
                codigo_tributacao: nac?.codigo ?? '',
                cnae: nac?.cnae ?? '',
                descricao: form.descricao || nac?.titulo || '',
              });
            }}
          >
            <option value="">Selecione um serviço</option>
            {servicos.length > 0 ? (
              <optgroup label="SERVIÇOS CADASTRADOS">
                {servicos.map(s => (
                  <option key={s.id} value={s.id}>
                    {`${s.cnae} | ${s.codigo_tributacao} ${s.descricao}`}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="SERVIÇOS NÃO CADASTRADOS">
              {listaNacional.map(s => (
                <option key={s.codigo} value={s.codigo}>
                  {/* A lista nacional não carrega CNAE: mostrar "undefined |"
                      seria pior que mostrar só o código de tributação. */}
                  {`${s.cnae ? `${s.cnae} | ` : ''}${s.codigo} ${s.titulo}`}
                </option>
              ))}
            </optgroup>
          </select>
          <Erro p={problemaDoCampo(problemas, 'servico_id')} />
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            Para cadastrar um serviço, acesse a{' '}
            <a href="/config/fiscal/servicos" className="underline">
              área de Serviços em Configurações de notas fiscais
            </a>
          </p>
        </div>

        {/* ── NBS ─────────────────────────────────────────────────────── */}
        {disponibilidade.nbs.liberado ? (
          <div className="flex flex-col gap-1.5">
            <Rotulo
              htmlFor="nf-nbs"
              ajuda="Nomenclatura Brasileira de Serviços. Exigida em serviço prestado para o exterior."
            >
              Código NBS <span className="fin-t-body font-normal text-[var(--fin-text-3)]">(Opcional)</span>
            </Rotulo>
            <div className="relative">
              <Input
                id="nf-nbs"
                value={form.nbs}
                placeholder="Selecione um código NBS"
                onChange={e => set('nbs', e.target.value)}
                className="pr-10"
              />
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fin-text-3)]"
              />
            </div>
          </div>
        ) : null}

        {/* ── Descrição ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <Rotulo htmlFor="nf-descricao">Descrição do serviço</Rotulo>
          <Textarea
            id="nf-descricao"
            rows={3}
            value={form.descricao}
            placeholder="Insira uma descrição para esse serviço"
            onChange={e => set('descricao', e.target.value)}
          />
          <Erro p={problemaDoCampo(problemas, 'descricao')} />
        </div>

        {/* ── Quem recolhe o ISS ──────────────────────────────────────── */}
        <fieldset className="flex flex-col gap-2">
          <legend className="flex items-center gap-1.5 fin-t-body-strong text-[var(--fin-text)]">
            Tipo de recolhimento do ISS
            <span
              title="Define quem entrega o imposto ao município. Retido pelo tomador, o valor é descontado do que a empresa recebe."
              className="inline-flex text-[var(--fin-text-3)]"
            >
              <Info aria-hidden="true" className="size-3.5" />
            </span>
          </legend>
          {([
            ['PRESTADOR', 'Prestador de serviço - Eu recolho o ISS'],
            ['TOMADOR', 'Tomador de serviço - Meu cliente retém o ISS'],
          ] as const).map(([valor, rotulo]) => (
            <label key={valor} className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="nf-recolhimento"
                checked={form.tipo_recolhimento_iss === valor}
                onChange={() => set('tipo_recolhimento_iss', valor)}
              />
              <span className="fin-t-body text-[var(--fin-text)]">{rotulo}</span>
            </label>
          ))}
        </fieldset>

        {/* ── Alíquota ISS ────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <Rotulo
            htmlFor="nf-aliquota"
            ajuda={
              disponibilidade.aliquota_iss.liberado
                ? 'Percentual do ISS do município sobre a base de cálculo.'
                : 'Quem calcula o ISS é a prefeitura, a partir do código de tributação.'
            }
          >
            Alíquota ISS
          </Rotulo>
          <div className="flex items-stretch">
            <span className="flex items-center rounded-l-[var(--fin-r-md)] border border-r-0 border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)] px-3 fin-t-body text-[var(--fin-text-3)]">
              %
            </span>
            {/* Somente leitura quando quem calcula é a prefeitura: campo
                editável faria acreditar que mudar o número muda o imposto. */}
            <input
              id="nf-aliquota"
              type="number"
              min={0}
              step="0.00001"
              inputMode="decimal"
              className={`${CAMPO} rounded-l-none ${disponibilidade.aliquota_iss.liberado ? '' : 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]'}`}
              value={form.aliquota_iss || ''}
              placeholder="0,00000"
              readOnly={!disponibilidade.aliquota_iss.liberado}
              aria-readonly={!disponibilidade.aliquota_iss.liberado}
              onChange={e => {
                if (!disponibilidade.aliquota_iss.liberado) return;
                set('aliquota_iss', num(e.target.value));
              }}
            />
          </div>
          {disponibilidade.aliquota_iss.liberado ? (
            <Erro p={problemaDoCampo(problemas, 'aliquota_iss')} />
          ) : (
            <p className="fin-t-caption text-[var(--fin-text-3)]">{disponibilidade.aliquota_iss.motivo}</p>
          )}
        </div>
      </div>

      {/* ── Reforma tributária ────────────────────────────────────────── */}
      <BlocoRecolhivel
        titulo="Reforma tributária"
        preenchido={!!(form.cst || form.classificacao_tributaria || form.indicador_operacao)}
        descricao={
          <>
            Em breve, estes dados serão obrigatórios. Preencha para se antecipar e garantir a
            conformidade legal. Por enquanto, você ainda pode emitir notas sem eles. Os códigos
            são os que a sua contabilidade informar: o sistema não escolhe por você.
          </>
        }
      >
        {disponibilidade.reforma.liberado ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Rotulo htmlFor="nf-cst" ajuda="Situação tributária do IBS/CBS, três dígitos.">
                Situação tributária (CST)
              </Rotulo>
              <Input
                id="nf-cst"
                value={form.cst}
                inputMode="numeric"
                maxLength={3}
                placeholder="000"
                onChange={e => set('cst', e.target.value.replace(/\D+/g, '').slice(0, 3))}
              />
              <Erro p={problemaDoCampo(problemas, 'cst')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Rotulo
                htmlFor="nf-classtrib"
                ajuda="Classificação tributária (cClassTrib), seis dígitos. Existe dentro de uma situação tributária."
              >
                Classificação tributária (cClassTrib)
              </Rotulo>
              <Input
                id="nf-classtrib"
                value={form.classificacao_tributaria}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                disabled={!form.cst}
                onChange={e => set('classificacao_tributaria', e.target.value.replace(/\D+/g, '').slice(0, 6))}
              />
              <Erro p={problemaDoCampo(problemas, 'classificacao_tributaria')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Rotulo htmlFor="nf-indicador" ajuda="Indicador da operação, um dígito.">
                Indicador da operação
              </Rotulo>
              <Input
                id="nf-indicador"
                value={form.indicador_operacao}
                inputMode="numeric"
                maxLength={1}
                placeholder="0"
                onChange={e => set('indicador_operacao', e.target.value.replace(/\D+/g, '').slice(0, 1))}
              />
            </div>
          </div>
        ) : (
          <BlocoFechado motivo={disponibilidade.reforma.motivo} />
        )}
      </BlocoRecolhivel>

      {/* ── Retenção na fonte ─────────────────────────────────────────── */}
      <BlocoRecolhivel
        titulo="Retenção na fonte"
        preenchido={form.aliquota_inss > 0 || form.aliquota_ir > 0}
        descricao={
          <>
            Preencha apenas os tributos que o cliente/tomador vai reter. Estes valores{' '}
            <strong>serão descontados do valor da cobrança</strong>. O valor da nota continua
            sendo o cheio.
          </>
        }
      >
        {disponibilidade.retencao.liberado ? (
          <>
            <ParDeRetencao
              rotulo="INSS retido"
              ajuda="Contribuição previdenciária retida pelo tomador sobre o serviço."
              id="nf-inss"
              aliquota={form.aliquota_inss}
              onAliquota={v => set('aliquota_inss', v)}
              valor={valores.retencao_inss}
            />
            <ParDeRetencao
              rotulo="IR retido"
              ajuda="Imposto de renda retido na fonte pelo tomador."
              id="nf-ir"
              aliquota={form.aliquota_ir}
              onAliquota={v => set('aliquota_ir', v)}
              valor={valores.retencao_ir}
            />
            <Erro p={problemaDoCampo(problemas, 'retencoes')} />
          </>
        ) : (
          <BlocoFechado motivo={disponibilidade.retencao.motivo} />
        )}
      </BlocoRecolhivel>

      {/* ── Outras deduções e observações ─────────────────────────────── */}
      <BlocoRecolhivel
        titulo="Outras deduções e observações"
        preenchido={form.deducoes > 0 || !!form.observacoes}
      >
        {disponibilidade.deducoes.liberado ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nf-deducoes">Deduções</Label>
            <div className="flex items-stretch">
              <span className="flex items-center rounded-l-[var(--fin-r-md)] border border-r-0 border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)] px-3 fin-t-body text-[var(--fin-text-3)]">
                R$
              </span>
              <input
                id="nf-deducoes"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className={`${CAMPO} rounded-l-none`}
                value={form.deducoes || ''}
                placeholder="0,00"
                onChange={e => set('deducoes', num(e.target.value))}
              />
            </div>
            <Erro p={problemaDoCampo(problemas, 'deducoes')} />
          </div>
        ) : (
          <BlocoFechado motivo={disponibilidade.deducoes.motivo} />
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nf-obs">Observações adicionais desta cobrança</Label>
          <Textarea
            id="nf-obs"
            rows={2}
            value={form.observacoes}
            placeholder="Observações adicionais"
            onChange={e => set('observacoes', e.target.value)}
          />
        </div>
      </BlocoRecolhivel>

      {/* ── O que não chega na prefeitura ─────────────────────────────── */}
      {naoViajam.length > 0 ? (
        <div className="rounded-[var(--fin-r-md)] border border-[var(--fin-warning)] bg-[var(--fin-warning-soft)] p-3">
          <span className="flex items-center gap-2 fin-t-body-strong text-[var(--fin-warning-text)]">
            <AlertTriangle aria-hidden="true" className="size-4" />
            O emissor atual não transmite estes campos
          </span>
          <p className="fin-t-caption mt-1 text-[var(--fin-text-2)]">
            {naoViajam.join(', ')}. O sistema guarda o que você preencheu e usa nos relatórios,
            mas a nota sai sem esses dados. Trocar de emissor em Configurações resolve.
          </p>
        </div>
      ) : null}

      {/* ── O valor da nota ───────────────────────────────────────────── */}
      <div className="border-t border-[var(--fin-border)] pt-3">
        <h3 className="fin-t-subhead text-[var(--fin-text)]">Valor da nota desta cobrança</h3>
        <div className="mt-2 flex flex-col gap-1.5">
          <Label htmlFor="nf-valor">Valor da nota fiscal</Label>
          <div className="flex items-stretch">
            <span className="flex items-center rounded-l-[var(--fin-r-md)] border border-r-0 border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)] px-3 fin-t-body text-[var(--fin-text-3)]">
              R$
            </span>
            <output
              id="nf-valor"
              className={`${CAMPO} flex items-center rounded-l-none bg-[var(--fin-surface-2)] fin-t-body-strong text-[var(--fin-text)]`}
            >
              {formatBRL(valores.valor_servicos).replace('R$', '').trim()}
            </output>
          </div>
          {valores.total_retido > 0 ? (
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Retenções de {formatBRL(valores.total_retido)}. A empresa recebe{' '}
              {formatBRL(valores.valor_liquido)}.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
