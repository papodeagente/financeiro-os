'use client';

/**
 * Painel de emissão da nota fiscal de uma parcela recebida.
 *
 * O painel existe para uma decisão só: a agência está agenciando ou prestando
 * serviço próprio? A resposta muda quanto de ISS ela paga, e o erro é caro
 * para os dois lados — emitir nota do valor cheio numa venda agenciada faz a
 * agência pagar imposto sobre repasse; emitir só a comissão num pacote
 * próprio é subdeclarar. Por isso os dois números aparecem antes do botão.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FileText, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Money } from '@/components/fin/Money';
import { CamposDaNota } from './CamposDaNota';
import {
  camposQueNaoViajam, formularioVazio, temErro, validarFormulario, valoresDaNota,
  type FormularioNota, type ServicoCadastrado,
} from '@/lib/nfse-formulario';
import { formatBRL } from '@/lib/utils';
import { lerErroNota } from '@/lib/nfse-simples';
import { toast } from '@/lib/toast';
import type { ContaReceber } from '@/lib/crm-types';
import type {
  FormaBaseIntermediacao, NotaFiscal, RegimeNota,
} from '@/lib/nfse-tipos';

interface Previa {
  pode_emitir: boolean;
  pendencias: string[];
  avisos: string[];
  erros: string[];
  iss_e_estimativa: boolean;
  emissor_aceita_deducoes: boolean;
  regime: RegimeNota;
  forma_base: FormaBaseIntermediacao;
  valor_recebido: number;
  valor_total_venda: number;
  custo_fornecedores: number;
  valor_servicos: number;
  valor_deducoes: number;
  base_calculo: number;
  aliquota_iss: number;
  valor_iss: number;
  valor_liquido: number;
  comissao_da_parcela: number;
  repasse_da_parcela: number;
  discriminacao: string;
  tomador: { cpf_cnpj: string; razao_social: string };
  nota_existente: NotaFiscal | null;
}

const CARTAO =
  'rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] p-3';

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: number; forte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={forte ? 'fin-t-body-strong text-[var(--fin-text)]' : 'fin-t-body text-[var(--fin-text-2)]'}>
        {rotulo}
      </span>
      <Money valor={valor} size={forte ? 'strong' : 'body'} estado="ok" />
    </div>
  );
}

export function PainelNota({
  conta,
  aberto,
  onFechar,
  onEmitida,
}: {
  conta: ContaReceber | null;
  aberto: boolean;
  onFechar: () => void;
  onEmitida: (nota: NotaFiscal) => void;
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [emitindo, setEmitindo] = useState(false);
  const [erroCarga, setErroCarga] = useState('');

  // Escolhas de quem está emitindo. Vazias significam "usar a configuração".
  const [regime, setRegime] = useState<RegimeNota | ''>('');
  const [formaBase, setFormaBase] = useState<FormaBaseIntermediacao | ''>('');
  const [discriminacao, setDiscriminacao] = useState('');
  const [issRetido, setIssRetido] = useState<boolean | null>(null);

  /**
   * O formulário completo, no desenho do Asaas (18/09/2026).
   *
   * `discriminacao` e `issRetido` continuam existindo porque são o que a API
   * de emissão já entende; eles são derivados deste formulário na hora de
   * enviar. Manter dois estados para a mesma pergunta seria pedir divergência,
   * então a fonte é o formulário e os dois antigos são projeção dele.
   */
  const [form, setForm] = useState<FormularioNota>(formularioVazio);
  const [servicos, setServicos] = useState<ServicoCadastrado[]>([]);
  const [listaNacional, setListaNacional] = useState<Array<{ codigo: string; cnae: string; titulo: string }>>([]);
  const [etapa, setEtapa] = useState<'form' | 'conferencia'>('form');

  const contaId = conta?.id ?? '';

  const carregar = useCallback(async () => {
    if (!contaId) return;
    setCarregando(true);
    setErroCarga('');
    try {
      const res = await fetch('/api/fiscal/previa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conta_receber_id: contaId,
          regime: regime || undefined,
          forma_base: formaBase || undefined,
          discriminacao: discriminacao || undefined,
          iss_retido: issRetido ?? undefined,
        }),
      });
      const corpo = await res.json();
      if (!res.ok) {
        setErroCarga(corpo?.error || 'Não foi possível calcular a nota.');
        setPrevia(null);
        return;
      }
      setPrevia(corpo as Previa);
      // A primeira carga adota o que o sistema sugeriu, para o usuário ver a
      // escolha marcada em vez de um campo vazio.
      if (!regime) setRegime((corpo as Previa).regime);
      if (!formaBase) setFormaBase((corpo as Previa).forma_base);
      if (!discriminacao) setDiscriminacao((corpo as Previa).discriminacao);
      // O formulário nasce com o que o sistema já sabe: descrição sugerida,
      // alíquota e quem recolhe o ISS vindos da configuração fiscal. Campo
      // que a pessoa já mexeu não é sobrescrito.
      setForm(f => ({
        ...f,
        descricao: f.descricao || (corpo as Previa).discriminacao || '',
        aliquota_iss: f.aliquota_iss || (corpo as Previa).aliquota_iss || 0,
        deducoes: f.deducoes || (corpo as Previa).valor_deducoes || 0,
      }));
    } catch {
      setErroCarga('Não foi possível calcular a nota.');
      setPrevia(null);
    } finally {
      setCarregando(false);
    }
    // discriminacao fora das dependências de propósito: recalcular a cada
    // tecla digitada no texto faria a tela piscar sem mudar número nenhum.
  }, [contaId, regime, formaBase, issRetido]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (aberto && contaId) void carregar();
    if (!aberto) {
      setPrevia(null); setRegime(''); setFormaBase('');
      setDiscriminacao(''); setIssRetido(null); setErroCarga('');
      setForm(formularioVazio()); setEtapa('form');
    }
  }, [aberto, contaId, carregar]);

  /** Catálogos do seletor de serviço: os da empresa e os da lista nacional. */
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    void (async () => {
      const [nac, cad] = await Promise.all([
        fetch('/api/fiscal/servicos?busca=').then(r => r.json()).catch(() => ({})),
        fetch('/api/fiscal/servicos-empresa').then(r => r.json()).catch(() => ({})),
      ]);
      if (!vivo) return;
      setListaNacional(
        ((nac?.servicos ?? []) as Array<{ codigo: string; item: string; titulo: string }>)
          .map(sv => ({ codigo: sv.codigo, cnae: '', titulo: `${sv.item} ${sv.titulo}` })),
      );
      setServicos((cad?.servicos ?? []) as ServicoCadastrado[]);
    })();
    return () => { vivo = false; };
  }, [aberto]);

  async function emitir() {
    if (!contaId || emitindo) return;
    setEmitindo(true);
    try {
      const res = await fetch('/api/fiscal/notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conta_receber_id: contaId,
          regime: regime || undefined,
          forma_base: formaBase || undefined,
          // O formulário é a fonte: a descrição e o ISS retido saem dele, e
          // os estados antigos ficam só como valor de partida.
          discriminacao: form.descricao || discriminacao || undefined,
          iss_retido: form.tipo_recolhimento_iss === 'TOMADOR',
          aliquota_iss: form.aliquota_iss || undefined,
          deducao_manual: form.deducoes > 0 ? form.deducoes : null,
          codigo_tributacao: form.codigo_tributacao || undefined,
          cnae: form.cnae || undefined,
          codigo_nbs: form.nbs || undefined,
          cst: form.cst || undefined,
          classificacao_tributaria: form.classificacao_tributaria || undefined,
          indicador_operacao: form.indicador_operacao || undefined,
          aliquota_inss: form.aliquota_inss || undefined,
          aliquota_ir: form.aliquota_ir || undefined,
          observacoes: form.observacoes || undefined,
        }),
      });
      const corpo = await res.json();
      if (!res.ok) {
        toast.error('A nota não foi emitida', corpo?.error || '');
        return;
      }
      const nota = corpo as NotaFiscal;
      if (nota.status === 'REJEITADA') {
        // A recusa chega como JSON da SefinNacional. Mostrar cru transfere
        // para a agência o trabalho de decifrar o layout da prefeitura.
        const legivel = lerErroNota(nota.erro);
        toast.error(
          'A prefeitura recusou a nota',
          legivel.explicacao || nota.erro || 'A prefeitura não explicou o motivo.',
        );
      } else if (nota.status === 'AUTORIZADA') {
        toast.success('Nota autorizada', nota.numero ? `Número ${nota.numero}` : '');
      } else {
        toast.success('Nota enviada', 'A prefeitura está processando. O status atualiza sozinho.');
      }
      onEmitida(nota);
      onFechar();
    } finally {
      setEmitindo(false);
    }
  }

  const intermediando = (regime || previa?.regime) === 'INTERMEDIACAO';

  // Os números saem do formulário, não da prévia: é o formulário que a pessoa
  // está mexendo agora. A prévia dá o valor de partida do serviço.
  const valores = valoresDaNota({
    valor_servicos: previa?.valor_servicos ?? 0,
    form,
  });
  const problemas = validarFormulario({
    form,
    valores,
    iss_e_estimativa: previa?.iss_e_estimativa ?? false,
  });
  const naoViajam = camposQueNaoViajam({
    form,
    capacidades: {
      deducoes: previa?.emissor_aceita_deducoes ?? false,
      // O padrão nacional calcula o ISS sozinho: a alíquota digitada aqui não
      // viaja, e `iss_e_estimativa` é exatamente esse aviso vindo do servidor.
      aliquota_por_nota: !(previa?.iss_e_estimativa ?? false),
    },
  });
  const impedido = temErro(problemas) || !previa?.pode_emitir;

  return (
    <Dialog open={aberto} onOpenChange={a => { if (!a) onFechar(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Emitir Nota Fiscal</DialogTitle>
          <DialogDescription className="sr-only">
            Dados da nota fiscal de serviço desta cobrança.
          </DialogDescription>
        </DialogHeader>

        {carregando && !previa ? (
          <p className="fin-t-body text-[var(--fin-text-3)]">Calculando a nota…</p>
        ) : erroCarga ? (
          <p className="fin-t-body text-[var(--fin-negative)]">{erroCarga}</p>
        ) : previa ? (
          <div className="flex flex-col gap-4">
            {/* ── Informações da cobrança ─────────────────────────────── */}
            <section className="flex flex-col gap-2">
              <h3 className="fin-t-subhead text-[var(--fin-text)]">Informações da cobrança</h3>
              <div>
                <span className="fin-t-caption text-[var(--fin-text-3)]">Cliente</span>
                <p className="fin-t-body text-[var(--fin-text)]">
                  {previa.tomador.razao_social || conta?.cliente_nome || 'Cliente sem nome'}
                  {previa.tomador.cpf_cnpj ? (
                    <span className="text-[var(--fin-text-3)]">{` · ${previa.tomador.cpf_cnpj}`}</span>
                  ) : null}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">Valor da cobrança</span>
                  <p className="fin-t-body text-[var(--fin-text)]">{formatBRL(previa.valor_recebido)}</p>
                </div>
                <div>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">Vencimento</span>
                  <p className="fin-t-body text-[var(--fin-text)]">
                    {(conta?.data_vencimento ?? '').slice(0, 10).split('-').reverse().join('/') || '—'}
                  </p>
                </div>
              </div>
            </section>

            {previa.nota_existente ? (
              <div className={`${CARTAO} border-[var(--fin-warning)] bg-[var(--fin-warning-soft)]`}>
                <span className="fin-t-body-strong text-[var(--fin-warning-text)]">
                  Esta parcela já tem nota
                </span>
                <p className="fin-t-caption text-[var(--fin-text-2)]">
                  {previa.nota_existente.numero
                    ? `Nota ${previa.nota_existente.numero}, ${previa.nota_existente.status.toLowerCase()}.`
                    : `Situação: ${previa.nota_existente.status.toLowerCase()}.`}{' '}
                  Cancele a nota atual antes de emitir outra.
                </p>
              </div>
            ) : null}

            {previa.pendencias.length > 0 ? (
              <div className={`${CARTAO} border-[var(--fin-negative)]`}>
                <span className="fin-t-body-strong flex items-center gap-2 text-[var(--fin-negative)]">
                  <AlertTriangle aria-hidden="true" className="size-4" />
                  Falta configurar antes de emitir
                </span>
                <ul className="mt-1 list-disc pl-5">
                  {previa.pendencias.map(p => (
                    <li key={p} className="fin-t-caption text-[var(--fin-text-2)]">{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {etapa === 'form' ? (
              <>
                {/* ── A pergunta que nenhum formulário genérico faz ─────── */}
                <fieldset className="flex flex-col gap-2">
                  <legend className="fin-t-subhead text-[var(--fin-text)]">
                    Como a agência entra nesta venda
                  </legend>
                  <label className={`${CARTAO} flex cursor-pointer gap-3 ${intermediando ? 'border-[var(--fin-accent)]' : ''}`}>
                    <input
                      type="radio"
                      name="regime-nota"
                      className="mt-1"
                      checked={intermediando}
                      onChange={() => setRegime('INTERMEDIACAO')}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="fin-t-body-strong text-[var(--fin-text)]">
                        Intermediando (agenciamento)
                      </span>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">
                        A nota é da comissão: {formatBRL(previa.comissao_da_parcela)}. O repasse de{' '}
                        {formatBRL(previa.repasse_da_parcela)} não é receita da agência.
                      </span>
                    </span>
                  </label>
                  <label className={`${CARTAO} flex cursor-pointer gap-3 ${!intermediando ? 'border-[var(--fin-accent)]' : ''}`}>
                    <input
                      type="radio"
                      name="regime-nota"
                      className="mt-1"
                      checked={!intermediando}
                      onChange={() => setRegime('PRESTACAO_DIRETA')}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="fin-t-body-strong text-[var(--fin-text)]">
                        Serviço próprio (prestação direta)
                      </span>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">
                        A nota é do valor inteiro recebido: {formatBRL(previa.valor_recebido)}.
                      </span>
                    </span>
                  </label>
                  {intermediando && previa.emissor_aceita_deducoes ? (
                    <select
                      aria-label="Como a intermediação aparece na nota"
                      className="h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)]"
                      value={formaBase || previa.forma_base}
                      onChange={e => setFormaBase(e.target.value as FormaBaseIntermediacao)}
                    >
                      <option value="VALOR_COMISSAO">Nota do valor da comissão</option>
                      <option value="TOTAL_COM_DEDUCAO">Valor cheio com o repasse como dedução</option>
                    </select>
                  ) : null}
                </fieldset>

                <CamposDaNota
                  form={form}
                  onForm={setForm}
                  valores={valores}
                  problemas={problemas}
                  servicos={servicos}
                  listaNacional={listaNacional}
                  issEhEstimativa={previa.iss_e_estimativa}
                  naoViajam={naoViajam}
                />
              </>
            ) : (
              /* ── Conferência: o passo que o modelo abre com "Avançar" ──
                 Emitir nota é ato fiscal, e desfazer custa burocracia. A
                 conferência mostra o que vai sair antes de sair. */
              <section className={`${CARTAO} flex flex-col gap-1.5`}>
                <span className="fin-t-body-strong text-[var(--fin-text)]">Confira antes de emitir</span>
                <Linha rotulo="Valor da nota" valor={valores.valor_servicos} forte />
                {valores.deducoes > 0 ? <Linha rotulo="Deduções" valor={valores.deducoes} /> : null}
                <Linha rotulo="Base de cálculo do ISS" valor={valores.base_calculo} />
                <Linha
                  rotulo={previa.iss_e_estimativa ? `ISS estimado (${form.aliquota_iss}%)` : `ISS (${form.aliquota_iss}%)`}
                  valor={valores.valor_iss}
                />
                {valores.retencao_inss > 0 ? <Linha rotulo="INSS retido" valor={valores.retencao_inss} /> : null}
                {valores.retencao_ir > 0 ? <Linha rotulo="IR retido" valor={valores.retencao_ir} /> : null}
                <div className="mt-1 border-t border-[var(--fin-border)] pt-1.5">
                  <Linha rotulo="A empresa recebe" valor={valores.valor_liquido} forte />
                </div>
                <p className="fin-t-caption mt-1 text-[var(--fin-text-2)]">
                  {form.descricao || 'Sem descrição.'}
                </p>
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  Tomador: {previa.tomador.razao_social || 'sem nome'}
                  {previa.tomador.cpf_cnpj ? ` · ${previa.tomador.cpf_cnpj}` : ''}
                </p>
                {previa.iss_e_estimativa ? (
                  <p className="fin-t-caption text-[var(--fin-text-3)]">
                    Quem calcula o ISS é a prefeitura, a partir do código de tributação. O valor
                    acima é estimativa para conferência.
                  </p>
                ) : null}
              </section>
            )}

            {previa.erros.map(e => (
              <p key={e} className="fin-t-caption flex items-start gap-2 text-[var(--fin-negative)]">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {e}
              </p>
            ))}
            {previa.avisos.map(a => (
              <p key={a} className="fin-t-caption flex items-start gap-2 text-[var(--fin-text-3)]">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {a}
              </p>
            ))}
          </div>
        ) : null}

        <DialogFooter>
          {etapa === 'conferencia' ? (
            <Button type="button" variant="outline" onClick={() => setEtapa('form')}>Voltar</Button>
          ) : (
            <Button type="button" variant="outline" onClick={onFechar}>Fechar</Button>
          )}
          {etapa === 'form' ? (
            <Button
              type="button"
              onClick={() => setEtapa('conferencia')}
              disabled={impedido || carregando}
            >
              Avançar
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => { void emitir(); }}
              disabled={impedido || emitindo}
            >
              <FileText aria-hidden="true" className="mr-2 size-4" />
              {emitindo ? 'Emitindo…' : 'Emitir nota'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
