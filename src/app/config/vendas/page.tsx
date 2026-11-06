'use client';

import * as React from 'react';
import { ShoppingBag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DataState } from '@/components/fin/DataState';
import { PageHeader } from '@/components/fin/PageHeader';
import { COMPONENTES, TIPOS_COMPONENTE, type TipoComponente } from '@/lib/venda-modelo';
import type { ConfigReceita } from '@/lib/venda-receita';
import type { LiquidarAutomaticamente, FormaLiquidavel } from '@/lib/venda-liquidar-auto';
import { loadEntities } from '@/lib/crm-storage';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Configurações › Vendas (E5, 05/11/2026; E7): quais componentes contam como
 * receita da agência (e se a taxa do cartão sai dela), e dinheiro e cheque
 * liquidados sozinhos numa conta padrão. A escolha da receita muda só a
 * receita mostrada e somada; o dinheiro que circula não muda.
 */

const SELECT = 'h-11 w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] disabled:opacity-60 lg:h-10';

const LIQUIDAR: Record<FormaLiquidavel, { rotulo: string; ajuda: string }> = {
  DINHEIRO: { rotulo: 'Dinheiro', ajuda: 'A conta da venda paga em dinheiro é baixada no dia da venda, na conta escolhida (o caixa da loja, por exemplo).' },
  CHEQUE: { rotulo: 'Cheque', ajuda: 'Cada cheque é baixado no dia do vencimento dele, na conta escolhida. A tarefa do dia cuida dos cheques para frente.' },
};

const SECAO = 'flex max-w-3xl flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)]';

const EXEMPLO: Record<TipoComponente, string> = {
  COMISSAO: 'Ex.: 10% da tarifa do hotel.',
  OVER: 'Ex.: incentivo da operadora por meta.',
  TAXA_DU: 'Ex.: R$ 40 por bilhete aéreo.',
  RAV: 'Ex.: R$ 30 por passageiro.',
  FEE: 'Ex.: taxa de consultoria cobrada à parte.',
  MARKUP: 'Ex.: margem somada ao preço do pacote.',
  DESCONTO: 'Sai da receita quando entra.',
  TAXA_CC: 'Sai da receita quando entra.',
  REPASSE_INTERMEDIARIO: 'Sai da receita quando entra.',
  COBRADO_NO_CANCELAMENTO: 'Ex.: multa de R$ 300 que o cliente paga ao desistir.',
  RETIDO_PELO_FORNECEDOR: 'Sai da receita quando entra.',
  ABATIMENTO: 'Não mexe na receita: baixa o cliente e o fornecedor juntos.',
};

export default function ConfigVendasPage() {
  const [config, setConfig] = React.useState<ConfigReceita | null>(null);
  const [liquidar, setLiquidar] = React.useState<LiquidarAutomaticamente | null>(null);
  const [contas, setContas] = React.useState<Array<{ id: string; nome: string }>>([]);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [sujo, setSujo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch('/api/config/vendas');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir.');
      setConfig(j.receita);
      setLiquidar(j.liquidar_automaticamente);
      setSujo(false);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);
  React.useEffect(() => {
    void loadEntities<{ id: string; nome: string; ativo?: boolean }>('contas-bancarias')
      .then(bs => setContas(bs.filter(b => b.ativo !== false).map(b => ({ id: b.id, nome: b.nome }))))
      .catch(() => undefined);
  }, []);

  async function salvar() {
    if (!config) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/config/vendas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receita: config, liquidar_automaticamente: liquidar }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi salvo.');
      setConfig(j.receita);
      setLiquidar(j.liquidar_automaticamente);
      setSujo(false);
      toast.success('Configuração salva', 'A receita das vendas já aparece com a escolha nova.');
    } catch (e) {
      toast.error('Não foi salvo', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  const somam = TIPOS_COMPONENTE.filter(t => COMPONENTES[t].sinal > 0);
  const tiram = TIPOS_COMPONENTE.filter(t => COMPONENTES[t].sinal < 0);
  const caixa = (t: TipoComponente) => (
    <label key={t} className={cn(
      'flex cursor-pointer items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-3)] py-[var(--fin-s-2)] transition-colors duration-[var(--fin-dur-rapida)]',
      config?.componentes[t] ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)] hover:bg-[var(--fin-surface-2)]',
    )}>
      <input
        type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]"
        checked={!!config?.componentes[t]}
        onChange={e => { setConfig(c => (c ? { ...c, componentes: { ...c.componentes, [t]: e.target.checked } } : c)); setSujo(true); }}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="fin-t-body-strong text-[var(--fin-text)]">{COMPONENTES[t].rotulo}</span>
        <span className="fin-t-caption text-[var(--fin-text-2)]">{COMPONENTES[t].ajuda}</span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">{EXEMPLO[t]}</span>
      </span>
    </label>
  );

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-s-5)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={ShoppingBag}
          titulo="Vendas"
          subtitulo="O que conta como receita da agência em cada venda. As contas a pagar e a receber não mudam com esta escolha."
        />
        <DataState
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
          esqueleto={<div className="h-64 max-w-3xl rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
        >
          {config ? (
            <div className="flex flex-col gap-[var(--fin-s-5)]">
              <section aria-labelledby="t-somam" className={SECAO}>
                <div className="flex flex-col gap-[var(--fin-s-1)]">
                  <h2 id="t-somam" className="fin-t-subhead text-[var(--fin-text)]">Somam à receita</h2>
                  <p className="fin-t-caption text-[var(--fin-text-2)]">Desmarque o que a agência trata como repasse e não como ganho dela. Fica fora da receita, mas aparece na ficha da venda como “fora da receita”.</p>
                </div>
                <div className="grid grid-cols-1 gap-[var(--fin-s-2)] sm:grid-cols-2">{somam.map(caixa)}</div>
              </section>
              <section aria-labelledby="t-tiram" className={SECAO}>
                <div className="flex flex-col gap-[var(--fin-s-1)]">
                  <h2 id="t-tiram" className="fin-t-subhead text-[var(--fin-text)]">Tiram da receita</h2>
                  <p className="fin-t-caption text-[var(--fin-text-2)]">O padrão do mercado é descontar todos. Desmarcar mostra a receita antes deles.</p>
                </div>
                <div className="grid grid-cols-1 gap-[var(--fin-s-2)] sm:grid-cols-2">
                  {tiram.map(caixa)}
                  <label className={cn(
                    'flex cursor-pointer items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-3)] py-[var(--fin-s-2)] transition-colors duration-[var(--fin-dur-rapida)]',
                    config.taxa_cartao ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)] hover:bg-[var(--fin-surface-2)]',
                  )}>
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]" checked={config.taxa_cartao}
                      onChange={e => { setConfig(c => (c ? { ...c, taxa_cartao: e.target.checked } : c)); setSujo(true); }} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="fin-t-body-strong text-[var(--fin-text)]">Taxa do cartão</span>
                      <span className="fin-t-caption text-[var(--fin-text-2)]">O que a operadora do cartão fica quando a agência recebe no cartão. Vem da taxa de cada forma, em Formas de pagamento.</span>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">Ex.: 3,49% de uma venda de R$ 1.000 = R$ 34,90.</span>
                    </span>
                  </label>
                </div>
              </section>
              {liquidar ? (
                <section aria-labelledby="t-liquidar" className={SECAO}>
                  <div className="flex flex-col gap-[var(--fin-s-1)]">
                    <h2 id="t-liquidar" className="fin-t-subhead text-[var(--fin-text)]">Liquidar automaticamente</h2>
                    <p className="fin-t-caption text-[var(--fin-text-2)]">Dinheiro e cheque já estão na mão quando a venda é feita. Ligado, a conta a receber deles é baixada sozinha, pelo caminho de sempre (com o caixa e o extrato em dia). Período fechado não é baixado: a conta fica em aberto e a venda avisa.</p>
                  </div>
                  <div className="flex flex-col gap-[var(--fin-s-3)]">
                    {(Object.keys(LIQUIDAR) as FormaLiquidavel[]).map(f => {
                      const r = liquidar[f];
                      const mudarRegra = (parcial: Partial<typeof r>) => { setLiquidar(l => (l ? { ...l, [f]: { ...l[f], ...parcial } } : l)); setSujo(true); };
                      return (
                        <div key={f} className="grid grid-cols-1 gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-[var(--fin-s-3)] sm:grid-cols-[1fr_minmax(0,18rem)] sm:items-center">
                          <label className="flex cursor-pointer items-start gap-[var(--fin-s-3)]">
                            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]" checked={r.ligado}
                              onChange={e => mudarRegra({ ligado: e.target.checked })} />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="fin-t-body-strong text-[var(--fin-text)]">{LIQUIDAR[f].rotulo}</span>
                              <span className="fin-t-caption text-[var(--fin-text-2)]">{LIQUIDAR[f].ajuda}</span>
                            </span>
                          </label>
                          <div className="flex flex-col gap-1">
                            <select aria-label={`Conta padrão: ${LIQUIDAR[f].rotulo}`} className={SELECT} value={r.conta_bancaria_id} disabled={!r.ligado}
                              onChange={e => mudarRegra({ conta_bancaria_id: e.target.value })}>
                              <option value="">Escolha a conta…</option>
                              {r.conta_bancaria_id && !contas.some(c => c.id === r.conta_bancaria_id) ? <option value={r.conta_bancaria_id}>Conta atual</option> : null}
                              {contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                            {r.ligado && !r.conta_bancaria_id ? <span className="fin-t-caption text-[var(--fin-warning-text)]">Sem conta, nada é baixado.</span> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              <div className="sticky bottom-0 z-[var(--fin-z-conteudo)] flex max-w-3xl flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] bg-[var(--fin-bg)] py-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
                <p className="fin-t-caption text-[var(--fin-text-3)]" aria-live="polite">{sujo ? 'Há alterações não salvas.' : 'Tudo salvo.'}</p>
                <div className="flex gap-[var(--fin-s-2)]">
                  {sujo ? <Button type="button" variant="ghost" onClick={() => { void carregar(); }} disabled={salvando}>Desfazer</Button> : null}
                  <Button type="button" onClick={() => { void salvar(); }} disabled={salvando || !sujo}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
                </div>
              </div>
            </div>
          ) : null}
        </DataState>
      </div>
    </div>
  );
}
