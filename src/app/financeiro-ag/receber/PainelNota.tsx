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
import { formatBRL } from '@/lib/utils';
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
    }
  }, [aberto, contaId, carregar]);

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
          discriminacao: discriminacao || undefined,
          iss_retido: issRetido ?? undefined,
        }),
      });
      const corpo = await res.json();
      if (!res.ok) {
        toast.error('A nota não foi emitida', corpo?.error || '');
        return;
      }
      const nota = corpo as NotaFiscal;
      if (nota.status === 'REJEITADA') {
        toast.error('A prefeitura recusou a nota', nota.erro || '');
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

  return (
    <Dialog open={aberto} onOpenChange={a => { if (!a) onFechar(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Emitir nota fiscal de serviço</DialogTitle>
          <DialogDescription>
            {conta?.cliente_nome
              ? `Parcela recebida de ${conta.cliente_nome}.`
              : 'Parcela recebida.'}{' '}
            A nota sai do valor que entrou, não do valor prometido.
          </DialogDescription>
        </DialogHeader>

        {carregando && !previa ? (
          <p className="fin-t-body text-[var(--fin-text-3)]">Calculando a nota…</p>
        ) : erroCarga ? (
          <p className="fin-t-body text-[var(--fin-negative)]">{erroCarga}</p>
        ) : previa ? (
          <div className="flex flex-col gap-4">
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

            {/* A escolha que muda o imposto. */}
            <fieldset className="flex flex-col gap-2">
              <legend className="fin-t-body-strong text-[var(--fin-text)]">
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
                    A agência aproxima o cliente do fornecedor e ganha comissão. A nota é da
                    comissão: {formatBRL(previa.comissao_da_parcela)} desta parcela. O repasse de{' '}
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
                    Pacote montado pela agência, consultoria ou taxa de serviço. A nota é do valor
                    inteiro recebido: {formatBRL(previa.valor_recebido)}.
                  </span>
                </span>
              </label>
            </fieldset>

            {intermediando ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="forma-base">Como a intermediação aparece na nota</Label>
                <select
                  id="forma-base"
                  className="h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)]"
                  value={formaBase || previa.forma_base}
                  onChange={e => setFormaBase(e.target.value as FormaBaseIntermediacao)}
                >
                  <option value="VALOR_COMISSAO">Nota do valor da comissão</option>
                  <option value="TOTAL_COM_DEDUCAO">Valor cheio com o repasse como dedução</option>
                </select>
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  Os dois caminhos dão o mesmo imposto. Municípios diferentes exigem formatos
                  diferentes: confirme com a contabilidade qual o seu aceita.
                </p>
              </div>
            ) : null}

            {/* Os números da nota. */}
            <div className={`${CARTAO} flex flex-col gap-1.5`}>
              <Linha rotulo="Valor do serviço na nota" valor={previa.valor_servicos} forte />
              {previa.valor_deducoes > 0 ? (
                <Linha rotulo="Deduções (repasse a fornecedores)" valor={previa.valor_deducoes} />
              ) : null}
              <Linha rotulo="Base de cálculo do ISS" valor={previa.base_calculo} />
              <Linha rotulo={`ISS (${previa.aliquota_iss}%)`} valor={previa.valor_iss} />
              <div className="mt-1 border-t border-[var(--fin-border)] pt-1.5">
                <Linha rotulo="A agência recebe" valor={previa.valor_liquido} forte />
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={issRetido ?? false}
                onChange={e => setIssRetido(e.target.checked)}
              />
              <span className="fin-t-body text-[var(--fin-text)]">
                ISS retido pelo tomador
              </span>
            </label>

            <div className="flex flex-col gap-2">
              <Label htmlFor="discriminacao">Descrição do serviço na nota</Label>
              <Textarea
                id="discriminacao"
                rows={3}
                value={discriminacao}
                onChange={e => setDiscriminacao(e.target.value)}
              />
            </div>

            <div className={`${CARTAO} flex flex-col gap-0.5`}>
              <span className="fin-t-caption text-[var(--fin-text-3)]">Tomador</span>
              <span className="fin-t-body text-[var(--fin-text)]">
                {previa.tomador.razao_social || 'Cliente sem nome'}
                {previa.tomador.cpf_cnpj ? ` · ${previa.tomador.cpf_cnpj}` : ''}
              </span>
            </div>

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
          <Button type="button" variant="outline" onClick={onFechar}>Fechar</Button>
          <Button
            type="button"
            onClick={() => { void emitir(); }}
            disabled={!previa?.pode_emitir || emitindo || carregando}
          >
            <FileText aria-hidden="true" className="mr-2 size-4" />
            {emitindo ? 'Emitindo…' : 'Emitir nota'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
