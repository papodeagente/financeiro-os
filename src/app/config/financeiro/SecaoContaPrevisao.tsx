'use client';

/**
 * Configurações › Financeiro › Conta previsão padrão (06/11/2026, E7).
 * A conta bancária onde se espera pagar ou receber quando o título não diz
 * qual: entra no fluxo de caixa por conta e aparece como sugestão no
 * lançamento. Só contas ativas.
 */
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/fin/Field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { contasParaEscolher } from '@/lib/contas-bancarias-regras';
import { toast } from '@/lib/toast';

const SECAO = 'flex max-w-3xl flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]';
const CONTROLE = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body lg:h-10 justify-between gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';
const NENHUMA = '__nenhuma__';

type Conta = { id: string; nome: string; ativo?: unknown };

export function SecaoContaPrevisao() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [escolhida, setEscolhida] = useState('');
  const [gravada, setGravada] = useState('');
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      fetch('/api/contas-bancarias', { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch('/api/config/financeiro/conta-previsao', { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ]).then(([lista, cfg]) => {
      if (!vivo) return;
      setContas(Array.isArray(lista)
        ? (lista as Array<Record<string, unknown>>).map(c => ({ id: String(c.id ?? ''), nome: String(c.nome ?? '') || 'Conta', ativo: c.ativo })).filter(c => c.id)
        : []);
      const id = typeof cfg?.conta_previsao_padrao === 'string' ? cfg.conta_previsao_padrao : '';
      setEscolhida(id);
      setGravada(id);
      setEstado('ok');
    }).catch(() => { if (vivo) setEstado('erro'); });
    return () => { vivo = false; };
  }, []);

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/config/financeiro/conta-previsao', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta_previsao_padrao: escolhida || null }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : `Erro ${r.status}`);
      setGravada(escolhida);
      toast.success(escolhida ? 'Conta previsão padrão salva' : 'Sem conta previsão padrão');
    } catch (e) {
      toast.error('Não foi possível salvar a conta previsão padrão', e instanceof Error ? e.message : '');
    } finally {
      setSalvando(false);
    }
  }

  const opcoes = contasParaEscolher(contas, escolhida || null);
  const nome = contas.find(c => c.id === escolhida)?.nome;

  return (
    <section aria-labelledby="t-conta-previsao" className={SECAO}>
      <div className="flex flex-col gap-[var(--fin-s-1)]">
        <h2 id="t-conta-previsao" className="fin-t-subhead text-[var(--fin-text)]">Conta previsão padrão</h2>
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          Onde a agência espera pagar e receber quando a conta não diz. O fluxo de caixa por conta usa esta conta para o que está em aberto.
        </p>
      </div>
      {estado === 'erro' ? (
        <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">Não foi possível ler as contas bancárias. Recarregue a página.</p>
      ) : (
        <div className="grid max-w-md grid-cols-1 gap-[var(--fin-s-3)]">
          <Field rotulo="Conta bancária" ajuda="Contas desativadas não aparecem aqui.">
            {a => (
              <Select value={escolhida || NENHUMA} onValueChange={v => setEscolhida(String(v) === NENHUMA ? '' : String(v))} disabled={estado === 'carregando'}>
                <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={CONTROLE}>
                  <SelectValue>{() => (estado === 'carregando' ? 'Carregando…' : nome ?? 'Nenhuma: cada conta diz a sua')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NENHUMA} className="fin-t-body">Nenhuma: cada conta diz a sua</SelectItem>
                  {opcoes.map(c => <SelectItem key={c.id} value={c.id} className="fin-t-body">{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
      )}
      <div>
        <Button type="button" onClick={() => { void salvar(); }} disabled={salvando || estado !== 'ok' || escolhida === gravada}>
          {salvando ? 'Salvando…' : 'Salvar conta previsão'}
        </Button>
      </div>
    </section>
  );
}

export default SecaoContaPrevisao;
