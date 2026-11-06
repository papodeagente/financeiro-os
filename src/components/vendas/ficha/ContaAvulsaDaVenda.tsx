'use client';

/**
 * Lançar, da ficha da venda (E7): pagamento avulso ao fornecedor, conta a
 * pagar ou conta a receber ligada à venda. O pagamento ao fornecedor desconta
 * da conta da venda daquela pessoa; as outras ficam ao lado, sem mexer nas
 * contas da venda.
 */
import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Field } from '@/components/fin/Field';
import { hojeISO } from '@/lib/money';
import { loadEntities } from '@/lib/crm-storage';
import type { FichaDaVenda } from '@/lib/venda-rota';
import { partesDoAcerto, ROTULO_AVULSA, type TipoDeAvulsa } from '@/lib/venda-avulsas-modelo';
import { toast } from '@/lib/toast';
import { CampoReais, CONTROLE, reais, ROTULO, SELECT } from './comum';

interface Pessoa { id: string; nome: string }

const EXPLICACAO: Record<TipoDeAvulsa, string> = {
  pagamento_fornecedor: 'Adianta parte do que a venda deve ao fornecedor, antes da fatura. A conta da venda com ele diminui na mesma medida: o total a pagar não muda.',
  pagar: 'Uma despesa que nasceu por causa da venda e não faz parte dela (entrega de documentos, taxa extra). Fica ligada à venda; mudar a venda não mexe nela.',
  receber: 'Um valor a receber combinado à parte (taxa extra, diferença de tarifa). Fica ligada à venda; mudar a venda não mexe nela.',
};

export function ContaAvulsaDaVenda({ ficha, tipo, onFechar, onLancada }: {
  ficha: FichaDaVenda; tipo: TipoDeAvulsa; onFechar: () => void; onLancada: (f: FichaDaVenda) => void;
}) {
  const daVenda = partesDoAcerto(ficha.venda);
  const [pessoas, setPessoas] = React.useState<Pessoa[]>(tipo === 'pagamento_fornecedor' ? daVenda : []);
  const inicial: Pessoa | null = tipo === 'receber' ? { id: ficha.venda.cliente.id, nome: ficha.venda.cliente.nome } : daVenda.length === 1 ? daVenda[0] : null;
  const [pessoa, setPessoa] = React.useState<Pessoa | null>(inicial);
  const [valor, setValor] = React.useState(0);
  const [vencimento, setVencimento] = React.useState(hojeISO());
  const [descricao, setDescricao] = React.useState('');
  const [observacoes, setObservacoes] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (tipo === 'pagamento_fornecedor') return;
    let vivo = true;
    const lista = tipo === 'receber'
      ? loadEntities<{ id: string; nome: string }>('clientes').then(cs => cs.map(c => ({ id: c.id, nome: c.nome || 'Cliente sem nome' })))
      : loadEntities<{ id: string; nome_fantasia?: string; razao_social?: string }>('fornecedores-crm').then(fs => fs.map(f => ({ id: f.id, nome: f.nome_fantasia || f.razao_social || 'Fornecedor sem nome' })));
    void lista.then(l => { if (vivo) setPessoas(l.sort((a, b) => a.nome.localeCompare(b.nome))); });
    return () => { vivo = false; };
  }, [tipo]);

  // O que a venda ainda deve à pessoa escolhida (só no pagamento ao fornecedor).
  const lado = tipo === 'pagamento_fornecedor' && pessoa
    ? ficha.posicao?.fornecedores.find(f => f.papel === 'fornecedor' && f.parte_id === pessoa.id) ?? null
    : null;

  async function lancar() {
    setErro(null);
    if (!pessoa) { setErro(tipo === 'receber' ? 'Escolha de quem receber.' : 'Escolha a quem pagar.'); return; }
    if (!(valor > 0)) { setErro('Informe um valor maior que zero.'); return; }
    setSalvando(true);
    try {
      const r = await fetch(`/api/vendas/completa/${encodeURIComponent(ficha.venda.id)}/avulsas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, pessoa, valor_centavos: valor, vencimento, descricao, observacoes }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error ?? 'Não foi lançada.'));
      const avisos = (j.avisos ?? []) as Array<{ mensagem: string }>;
      toast.success(`${ROTULO_AVULSA[tipo]} lançado`, avisos[0]?.mensagem ?? (tipo === 'pagamento_fornecedor' ? 'A conta da venda com o fornecedor já diminuiu.' : 'Já aparece nas contas da venda.'));
      onLancada(j.ficha as FichaDaVenda);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi lançada.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <RecordSheet
      aberto onOpenChange={a => { if (!a) onFechar(); }}
      titulo={ROTULO_AVULSA[tipo]}
      descricao={EXPLICACAO[tipo]}
      largura={640}
      sujo={valor > 0 || !!descricao}
      resumo={lado ? <span className="fin-t-caption text-[var(--fin-text-2)]">A venda deve a {lado.nome} <strong className="tabular-nums text-[var(--fin-text)]">{reais(lado.em_aberto)}</strong> em aberto.</span> : undefined}
      acaoPrimaria={{ rotulo: salvando ? 'Lançando…' : 'Lançar', onClick: () => { void lancar(); }, desabilitado: salvando }}
      acaoSecundaria={{ rotulo: 'Cancelar', onClick: onFechar }}
    >
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <Field rotulo={tipo === 'receber' ? 'De quem receber' : 'A quem pagar'} obrigatorio
          ajuda={tipo === 'pagamento_fornecedor' && !daVenda.length ? 'A venda ainda não tem fornecedor cadastrado.' : undefined}>
          {a => (
            <select {...a} className={SELECT} value={pessoa?.id ?? ''} onChange={e => setPessoa(pessoas.find(x => x.id === e.target.value) ?? null)}>
              <option value="">Escolha…</option>
              {pessoa && !pessoas.some(x => x.id === pessoa.id) ? <option value={pessoa.id}>{pessoa.nome}</option> : null}
              {pessoas.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className={ROTULO}>Valor</span>
            <CampoReais rotulo="Valor" centavos={valor} onChange={setValor} />
            {lado && lado.em_aberto > 0 && valor !== lado.em_aberto ? (
              <button type="button" className="self-start fin-t-caption text-[var(--fin-accent)] underline-offset-2 hover:underline" onClick={() => setValor(lado.em_aberto)}>
                Usar o que falta: {reais(lado.em_aberto)}
              </button>
            ) : null}
          </div>
          <Field rotulo="Vencimento" obrigatorio>
            {a => <Input {...a} type="date" className={CONTROLE} value={vencimento} onChange={e => setVencimento(e.target.value)} />}
          </Field>
        </div>
        <Field rotulo="Descrição" ajuda="Vazio: o sistema escreve pela venda.">
          {a => <Input {...a} className={CONTROLE} maxLength={300} value={descricao} onChange={e => setDescricao(e.target.value)} />}
        </Field>
        <Field rotulo="Observação">
          {a => <Textarea {...a} className="min-h-16 fin-t-body" maxLength={1000} value={observacoes} onChange={e => setObservacoes(e.target.value)} />}
        </Field>
        {erro ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}
      </div>
    </RecordSheet>
  );
}
