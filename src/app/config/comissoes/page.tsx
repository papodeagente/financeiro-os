'use client';

import * as React from 'react';
import { Percent } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DataState } from '@/components/fin/DataState';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { Field } from '@/components/fin/Field';
import { Callout } from '@/components/fin/Callout';
import { EscolhaDaBase } from '@/components/comissoes/EscolhaDaBase';
import { rotuloDoPeriodoDaMeta, type ConfigComissao } from '@/lib/comissao-funcoes';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Configurações › Comissões (E5, parte F): a agência escolhe se continua na
 * regra de hoje (tela de Comissões, calculada como sempre) ou passa para a
 * comissão por função, calculada no servidor todo dia; e, na regra por
 * função, quando a comissão é liberada e sobre o que a meta é medida.
 */

const SECAO = 'flex max-w-3xl flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)] shadow-[var(--fin-e-card)]';

function Opcao({ marcada, onEscolher, titulo, texto, nome }: { marcada: boolean; onEscolher: () => void; titulo: string; texto: string; nome: string }) {
  return (
    <label className={cn(
      'flex cursor-pointer items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-3)] py-[var(--fin-s-3)] transition-colors duration-[var(--fin-dur-rapida)]',
      marcada ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)] hover:bg-[var(--fin-surface-2)]',
    )}>
      <input type="radio" name={nome} className="mt-1 size-4 shrink-0 accent-[var(--fin-accent)]" checked={marcada} onChange={onEscolher} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="fin-t-body-strong text-[var(--fin-text)]">{titulo}</span>
        <span className="fin-t-caption text-[var(--fin-text-2)]">{texto}</span>
      </span>
    </label>
  );
}

export default function ConfigComissoesPage() {
  const [config, setConfig] = React.useState<ConfigComissao | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [sujo, setSujo] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch('/api/comissoes-por-funcao/config');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir.');
      setConfig(j);
      setSujo(false);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const mudar = (parte: Partial<ConfigComissao>) => { setConfig(c => (c ? { ...c, ...parte } : c)); setSujo(true); };

  async function salvar() {
    if (!config) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/comissoes-por-funcao/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi salvo.');
      setConfig(j);
      setSujo(false);
      toast.success('Configuração salva', j.regra === 'FUNCOES' ? 'A comissão passa a ser calculada por função, todo dia.' : 'A comissão continua pela tela de Comissões, como sempre.');
    } catch (e) {
      toast.error('Não foi salvo', e instanceof Error ? e.message : undefined);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <MolduraDaPagina>
      <PageHeader icone={Percent} titulo="Comissões" subtitulo="Como a agência calcula, libera e fecha a comissão da equipe." />
      <DataState
        className={RITMO_DA_PAGINA}
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={<div className="h-64 max-w-3xl animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
      >
        {config ? (
          <>
            <section aria-labelledby="t-regra" className={SECAO}>
              <h2 id="t-regra" className="fin-t-subhead text-[var(--fin-text)]">Regra de cálculo</h2>
              <div className="grid grid-cols-1 gap-[var(--fin-s-2)] sm:grid-cols-2">
                <Opcao nome="regra" marcada={config.regra === 'ATUAL'} onEscolher={() => mudar({ regra: 'ATUAL' })}
                  titulo="Plano por vendedor (como hoje)" texto="Faixas pelo acumulado do mês e regras por produto, na tela de Comissões. Nada muda." />
                <Opcao nome="regra" marcada={config.regra === 'FUNCOES'} onEscolher={() => mudar({ regra: 'FUNCOES' })}
                  titulo="Por função, calculada todo dia" texto="Vendedor, intermediário e outras funções, plano em matriz, Fechar e Pagar comissões." />
              </div>
              {config.regra === 'FUNCOES' ? (
                <Callout tom="info" titulo="Ao mudar de regra">
                  As vendas antes da data inicial não são recalculadas. As comissões já aprovadas na tela de Comissões continuam como estão.
                </Callout>
              ) : null}
            </section>

            {config.regra === 'FUNCOES' ? (
              <>
                <section aria-labelledby="t-liberar" className={SECAO}>
                  <h2 id="t-liberar" className="fin-t-subhead text-[var(--fin-text)]">Quando a comissão é liberada</h2>
                  <div className="grid grid-cols-1 gap-[var(--fin-s-2)] sm:grid-cols-2">
                    <Opcao nome="liberar" marcada={config.liberar === 'VENDA'} onEscolher={() => mudar({ liberar: 'VENDA' })}
                      titulo="Na venda" texto="A comissão inteira fica liberada na data da venda." />
                    <Opcao nome="liberar" marcada={config.liberar === 'RECEBIMENTO'} onEscolher={() => mudar({ liberar: 'RECEBIMENTO' })}
                      titulo="No recebimento do cliente" texto="Libera na proporção do que o cliente já pagou. Pagou metade, libera metade." />
                  </div>
                  <label className="flex items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)]">
                    <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" checked={config.so_vendas_fechadas} onChange={e => mudar({ so_vendas_fechadas: e.target.checked })} />
                    Só vendas fechadas geram comissão
                  </label>
                </section>

                <section aria-labelledby="t-meta" className={SECAO}>
                  <h2 id="t-meta" className="fin-t-subhead text-[var(--fin-text)]">Meta</h2>
                  <p className="fin-t-caption text-[var(--fin-text-2)]">O resultado de cada pessoa no mês, comparado com a meta dela, define a faixa do plano.</p>
                  <EscolhaDaBase rotulo="A meta é medida sobre" valor={config.meta_sobre} onChange={v => mudar({ meta_sobre: v })} />
                  <Field
                    rotulo="Dia de fechamento das metas"
                    ajuda={config.dia_fechamento_meta
                      ? `A meta de cada mês vai do dia ${config.dia_fechamento_meta + 1} do mês anterior ao dia ${config.dia_fechamento_meta}. Ex.: a meta de novembro ${rotuloDoPeriodoDaMeta('2026-11', config.dia_fechamento_meta)}.`
                      : 'A meta de cada mês vai do dia 1 ao último dia do mês. Os dias 28 a 31 também valem como último dia.'}
                  >
                    {a => (
                      <select {...a} value={config.dia_fechamento_meta} onChange={e => mudar({ dia_fechamento_meta: Number(e.target.value) })}
                        className="h-11 w-full max-w-xs rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] lg:h-10">
                        <option value={0}>Último dia do mês</option>
                        {Array.from({ length: 27 }, (_, i) => i + 1).map(d => <option key={d} value={d}>Dia {d}</option>)}
                      </select>
                    )}
                  </Field>
                  <Field rotulo="Vendas a partir de" ajuda="Vendas anteriores não entram na comissão por função.">
                    {a => (
                      <input {...a} type="date" value={config.data_inicial} onChange={e => mudar({ data_inicial: e.target.value })}
                        className="h-11 w-full max-w-xs rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] lg:h-10" />
                    )}
                  </Field>
                </section>
              </>
            ) : null}

            <div className="sticky bottom-0 z-[var(--fin-z-conteudo)] flex max-w-3xl flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] bg-[var(--fin-bg)] py-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
              <p className="fin-t-caption text-[var(--fin-text-3)]" aria-live="polite">{sujo ? 'Há alterações não salvas.' : 'Tudo salvo.'}</p>
              <div className="flex gap-[var(--fin-s-2)]">
                {sujo ? <Button type="button" variant="ghost" onClick={() => { void carregar(); }} disabled={salvando}>Desfazer</Button> : null}
                <Button type="button" onClick={() => { void salvar(); }} disabled={salvando || !sujo}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
              </div>
            </div>
          </>
        ) : null}
      </DataState>
    </MolduraDaPagina>
  );
}
