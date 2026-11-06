'use client';

/**
 * Configurações › Financeiro › Categoria das contas geradas (06/11/2026, E7).
 * Em que categoria nasce cada conta que o sistema cria sozinho: recebimento
 * da venda, pagamento e fatura do fornecedor, reembolsos e restituição de
 * comissão. Sem escolha, a conta nasce sem categoria, como antes. Mudar aqui
 * vale para as contas novas; as já gravadas ficam como estão.
 */
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/fin/Field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { loadEntities } from '@/lib/crm-storage';
import type { PlanoContas } from '@/lib/crm-types';
import { CATEGORIAS_DOS_TITULOS, type CategoriasDosTitulos } from '@/lib/categorias-padrao-titulos';
import { toast } from '@/lib/toast';

const SECAO = 'flex max-w-3xl flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]';
const CONTROLE = 'h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body lg:h-10 justify-between gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';
const NENHUMA = '__nenhuma__';

export function SecaoCategoriasDosTitulos() {
  const [plano, setPlano] = useState<PlanoContas[]>([]);
  const [escolha, setEscolha] = useState<CategoriasDosTitulos>({});
  const [gravada, setGravada] = useState('{}');
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      loadEntities<PlanoContas>('plano-contas'),
      fetch('/api/config/financeiro/categorias-dos-titulos', { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ]).then(([p, cfg]) => {
      if (!vivo) return;
      setPlano(p);
      const c = (cfg?.categorias ?? {}) as CategoriasDosTitulos;
      setEscolha(c);
      setGravada(JSON.stringify(c));
      setEstado('ok');
    }).catch(() => { if (vivo) setEstado('erro'); });
    return () => { vivo = false; };
  }, []);

  const mudou = JSON.stringify(escolha) !== gravada;

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/config/financeiro/categorias-dos-titulos', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categorias: escolha }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : `Erro ${r.status}`);
      const c = (corpo.categorias ?? {}) as CategoriasDosTitulos;
      setEscolha(c);
      setGravada(JSON.stringify(c));
      toast.success('Categorias das contas geradas salvas', 'Valem para as próximas contas; as já lançadas ficam como estão.');
    } catch (e) {
      toast.error('Não foi possível salvar as categorias', e instanceof Error ? e.message : '');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section aria-labelledby="t-categorias-titulos" className={SECAO}>
      <div className="flex flex-col gap-[var(--fin-s-1)]">
        <h2 id="t-categorias-titulos" className="fin-t-subhead text-[var(--fin-text)]">Categoria das contas geradas</h2>
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          Em que categoria nasce cada conta que o sistema cria sozinho. Sem escolha, a conta nasce sem categoria e você classifica depois.
          Mudar aqui vale para as próximas contas; as já lançadas ficam como estão.
        </p>
      </div>
      {estado === 'erro' ? (
        <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">Não foi possível ler o plano de contas. Recarregue a página.</p>
      ) : (
        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
          {CATEGORIAS_DOS_TITULOS.map(def => {
            const opcoes = plano
              .filter(c => String(c.tipo).toUpperCase() === def.tipo && (c as PlanoContas & { ativo?: boolean }).ativo !== false)
              .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), undefined, { numeric: true }));
            const id = escolha[def.chave];
            const atual = id ? plano.find(c => c.id === id) : undefined;
            return (
              <Field key={def.chave} rotulo={def.rotulo} ajuda={def.explica}>
                {a => (
                  <Select
                    value={id || NENHUMA}
                    onValueChange={v => setEscolha(x => {
                      const proximo = { ...x };
                      if (!v || String(v) === NENHUMA) delete proximo[def.chave];
                      else proximo[def.chave] = String(v);
                      return proximo;
                    })}
                    disabled={estado !== 'ok'}
                  >
                    <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={CONTROLE}>
                      <SelectValue>{() => (estado === 'carregando' ? 'Carregando…' : atual ? `${atual.codigo} · ${atual.nome}` : 'Sem categoria')}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NENHUMA} className="fin-t-body">Sem categoria</SelectItem>
                      {opcoes.map(c => <SelectItem key={c.id} value={c.id} className="fin-t-body">{c.codigo} · {c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            );
          })}
        </div>
      )}
      <div>
        <Button type="button" onClick={() => { void salvar(); }} disabled={salvando || estado !== 'ok' || !mudou}>
          {salvando ? 'Salvando…' : 'Salvar categorias das contas geradas'}
        </Button>
      </div>
    </section>
  );
}

export default SecaoCategoriasDosTitulos;
