'use client';

/**
 * Emitir o cheque de uma conta a pagar em aberto (E7, frente C): conta do
 * talão, número (o próximo, sugerido), data, "bom para", favorecido, cidade e
 * valor (o que falta pagar). Ao emitir, abre a página de impressão. Nada é
 * pago aqui: a conta continua em aberto até a liquidação com forma cheque e o
 * mesmo número.
 */
import * as React from 'react';

import type { ContaBancaria, ContaPagar } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { hojeISO, num, round2 } from '@/lib/money';
import { toast } from '@/lib/toast';
import { Field } from '@/components/fin/Field';
import { MoneyField } from '@/components/fin/MoneyField';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body lg:h-10';
const SELECT = cn(CONTROLE, 'w-full border px-3 text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]');

export function EmitirCheque({ conta, onFechar }: { conta: ContaPagar | null; onFechar: () => void }) {
  // Uma janela nova por conta: os campos nascem da conta escolhida.
  return conta ? <JanelaDoCheque key={conta.id} conta={conta} onFechar={onFechar} /> : null;
}

function JanelaDoCheque({ conta, onFechar }: { conta: ContaPagar; onFechar: () => void }) {
  const saldo = round2(num(conta.valor_final ?? conta.valor_original) - num(conta.valor_pago));
  const [contas, setContas] = React.useState<ContaBancaria[]>([]);
  const [contaId, setContaId] = React.useState('');
  const [numero, setNumero] = React.useState('');
  const [emissao, setEmissao] = React.useState(hojeISO());
  const [bomPara, setBomPara] = React.useState('');
  const [favorecido, setFavorecido] = React.useState((conta.fornecedor_nome || '').trim());
  const [cidade, setCidade] = React.useState('');
  const [valor, setValor] = React.useState(saldo);
  const [erro, setErro] = React.useState<string | null>(null);
  const [gravando, setGravando] = React.useState(false);

  React.useEffect(() => {
    let vivo = true;
    loadEntities<ContaBancaria>('contas-bancarias')
      .then(cs => {
        if (!vivo) return;
        const correntes = cs.filter(c => c.tipo !== 'CARTAO_CREDITO');
        setContas(correntes);
        const preferida = correntes.find(c => c.id === conta.conta_bancaria_id) ?? correntes[0];
        setContaId(preferida?.id ?? '');
      })
      .catch(() => setContas([]));
    return () => { vivo = false; };
  }, [conta]);

  // Número sugerido e cidade padrão da conta do talão.
  React.useEffect(() => {
    if (!contaId) return;
    let vivo = true;
    fetch(`/api/cheques/configuracao?conta=${encodeURIComponent(contaId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((c: { proximo_numero?: string; config?: { cidade_padrao?: string } } | null) => {
        if (!vivo || !c) return;
        setNumero(c.proximo_numero ?? '');
        setCidade(c.config?.cidade_padrao ?? '');
      })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [contaId]);

  async function emitir() {
    setErro(null);
    setGravando(true);
    try {
      const r = await fetch('/api/cheques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo_id: conta.id, conta_bancaria_id: contaId, numero, emissao, bom_para: bomPara || null,
          favorecido, cidade, valor_centavos: Math.round(valor * 100),
        }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(corpo.error ?? 'Não foi possível emitir o cheque.'); return; }
      toast.success('Cheque emitido', `Nº ${corpo.numero}. Abrindo a impressão.`);
      onFechar();
      window.open(`/financeiro-ag/cheques/${encodeURIComponent(corpo.id)}/imprimir`, '_blank', 'noopener');
    } finally {
      setGravando(false);
    }
  }

  return (
    <RecordSheet
      aberto
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo="Imprimir cheque"
      descricao={`${conta.fornecedor_nome || 'Conta sem fornecedor'}${conta.descricao ? ` · ${conta.descricao}` : ''}`}
      largura={640}
      resumo={
        <span className="fin-t-caption text-[var(--fin-text-2)]">
          O cheque fica registrado como emitido e a impressão abre em outra aba. A conta continua em aberto: ao pagar, escolha a forma
          cheque e o mesmo número.
        </span>
      }
      acaoPrimaria={{ rotulo: 'Emitir e imprimir', onClick: emitir, carregando: gravando, desabilitado: !contaId || !numero.trim() || valor <= 0 }}
    >
      <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-2">
        <Field rotulo="Conta do talão" obrigatorio ajuda={contas.length ? undefined : 'Nenhuma conta corrente liberada para você.'}>
          {a => (
            <select {...a} className={SELECT} value={contaId} onChange={e => setContaId(e.target.value)}>
              {contas.map(c => <option key={c.id} value={c.id}>{c.nome || 'Conta sem nome'}{c.banco ? ` · ${c.banco}` : ''}</option>)}
            </select>
          )}
        </Field>
        <Field rotulo="Número do cheque" obrigatorio ajuda="Sugerimos o próximo do talão.">
          {a => <Input {...a} className={CONTROLE} inputMode="numeric" value={numero} maxLength={12} onChange={e => setNumero(e.target.value)} />}
        </Field>
        <Field rotulo="Data do cheque" obrigatorio>
          {a => <Input {...a} type="date" className={CONTROLE} value={emissao} onChange={e => setEmissao(e.target.value)} />}
        </Field>
        <Field rotulo="Bom para" ajuda="Cheque pré-datado: a data em que o fornecedor pode depositar.">
          {a => <Input {...a} type="date" className={CONTROLE} value={bomPara} min={emissao} onChange={e => setBomPara(e.target.value)} />}
        </Field>
        <Field rotulo="Favorecido" ajuda="Vazio: cheque ao portador.">
          {a => <Input {...a} className={CONTROLE} value={favorecido} maxLength={120} onChange={e => setFavorecido(e.target.value)} />}
        </Field>
        <Field rotulo="Cidade" ajuda="Vai antes da data no cheque.">
          {a => <Input {...a} className={CONTROLE} value={cidade} maxLength={60} onChange={e => setCidade(e.target.value)} />}
        </Field>
        <div className="sm:col-span-2">
          <MoneyField rotulo="Valor" obrigatorio valor={valor} onChange={setValor} maximo={saldo} ajuda="Até o que falta pagar nesta conta." />
        </div>
      </div>
      {erro ? <p role="alert" className="mt-[var(--fin-s-3)] fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}
    </RecordSheet>
  );
}

export default EmitirCheque;
