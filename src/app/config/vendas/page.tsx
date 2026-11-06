'use client';

import * as React from 'react';
import { ShoppingBag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DataState } from '@/components/fin/DataState';
import { PageHeader } from '@/components/fin/PageHeader';
import { COMPONENTES, TIPOS_COMPONENTE, type TipoComponente } from '@/lib/venda-modelo';
import type { ConfigReceita } from '@/lib/venda-receita';
import {
  CONFIG_DO_RECIBO_PADRAO, MARCADORES_DO_RECIBO, TEXTO_DO_RECIBO_PADRAO,
  marcadoresDesconhecidos, preencherTexto, type ConfigDoRecibo,
} from '@/lib/recibo-da-venda';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * Configurações › Vendas (E5, 05/11/2026): quais componentes contam como
 * receita da agência. Muda a receita mostrada e somada (ficha da venda,
 * painéis, comissão sobre a receita); o dinheiro que circula não muda.
 * E7 (06/11/2026): o texto do recibo da venda, com campos e prévia.
 */

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
};

export default function ConfigVendasPage() {
  const [config, setConfig] = React.useState<ConfigReceita | null>(null);
  const [recibo, setRecibo] = React.useState<ConfigDoRecibo>(CONFIG_DO_RECIBO_PADRAO);
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
      setRecibo(j.recibo ?? CONFIG_DO_RECIBO_PADRAO);
      setSujo(false);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  async function salvar() {
    if (!config) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/config/vendas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receita: config, recibo }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi salvo.');
      setConfig(j.receita);
      setRecibo(j.recibo ?? CONFIG_DO_RECIBO_PADRAO);
      setSujo(false);
      toast.success('Configuração salva', 'A receita das vendas e o texto do recibo já valem com a escolha nova.');
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
        onChange={e => { setConfig(c => (c ? { componentes: { ...c.componentes, [t]: e.target.checked } } : c)); setSujo(true); }}
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
          subtitulo="O que conta como receita da agência em cada venda e o texto do recibo que o cliente recebe. As contas a pagar e a receber não mudam com estas escolhas."
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
                <div className="grid grid-cols-1 gap-[var(--fin-s-2)] sm:grid-cols-2">{tiram.map(caixa)}</div>
              </section>
              <TextoDoRecibo valor={recibo} onMudar={v => { setRecibo(v); setSujo(true); }} />
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

const EXEMPLOS: Record<string, string> = Object.fromEntries(MARCADORES_DO_RECIBO.map(m => [m.marca.slice(1, -1), m.exemplo]));

/** O texto do recibo da venda: a declaração com campos, o complemento e a prévia com dados de exemplo. */
function TextoDoRecibo({ valor, onMudar }: { valor: ConfigDoRecibo; onMudar: (v: ConfigDoRecibo) => void }) {
  const campo = React.useRef<HTMLTextAreaElement>(null);
  const texto = valor.texto || TEXTO_DO_RECIBO_PADRAO;
  const desconhecidos = marcadoresDesconhecidos(texto);
  const inserir = (marca: string) => {
    const el = campo.current;
    const ini = el ? el.selectionStart : texto.length;
    const fim = el ? el.selectionEnd : texto.length;
    onMudar({ ...valor, texto: texto.slice(0, ini) + marca + texto.slice(fim) });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(ini + marca.length, ini + marca.length);
    });
  };
  return (
    <section aria-labelledby="t-recibo" className={SECAO}>
      <div className="flex flex-col gap-[var(--fin-s-1)]">
        <h2 id="t-recibo" className="fin-t-subhead text-[var(--fin-text)]">Texto do recibo da venda</h2>
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          A declaração que abre o recibo de cada pagante (botão Recibo na ficha da venda). Os campos entre chaves viram os dados da venda na hora de imprimir.
        </p>
      </div>
      <div className="flex flex-col gap-[var(--fin-s-2)]">
        <label htmlFor="recibo-texto" className="fin-t-caption font-medium text-[var(--fin-text-2)]">Declaração</label>
        <Textarea
          id="recibo-texto" ref={campo} rows={5} maxLength={1500}
          value={texto}
          onChange={e => onMudar({ ...valor, texto: e.target.value.trim() === TEXTO_DO_RECIBO_PADRAO ? '' : e.target.value })}
          className="fin-t-body"
          aria-describedby="recibo-campos"
        />
        <div id="recibo-campos" className="flex flex-wrap items-center gap-[var(--fin-s-1)]">
          <span className="fin-t-caption text-[var(--fin-text-3)]">Inserir:</span>
          {MARCADORES_DO_RECIBO.map(m => (
            <button
              key={m.marca} type="button" onClick={() => inserir(m.marca)} title={`Ex.: ${m.exemplo}`}
              className="rounded-[var(--fin-r-sm)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-2 py-0.5 fin-t-caption text-[var(--fin-text-2)] transition-colors duration-[var(--fin-dur-rapida)] hover:border-[var(--fin-accent)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
            >
              {m.rotulo}
            </button>
          ))}
          {valor.texto ? (
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => onMudar({ ...valor, texto: '' })}>Voltar ao texto padrão</Button>
          ) : null}
        </div>
        {desconhecidos.length ? (
          <p role="status" className="rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-warning-text)]">
            {desconhecidos.join(', ')} {desconhecidos.length === 1 ? 'não é um campo do recibo e vai sair escrito assim' : 'não são campos do recibo e vão sair escritos assim'}. Use os botões acima para inserir os campos.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-[var(--fin-s-2)]">
        <label htmlFor="recibo-complemento" className="fin-t-caption font-medium text-[var(--fin-text-2)]">Complemento (opcional)</label>
        <Textarea
          id="recibo-complemento" rows={2} maxLength={600}
          value={valor.complemento}
          placeholder="Ex.: condições de cancelamento, telefone de plantão ou uma observação fixa."
          onChange={e => onMudar({ ...valor, complemento: e.target.value })}
          className="fin-t-body"
        />
      </div>
      <figure className="flex flex-col gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-4)]">
        <figcaption className="fin-t-caption text-[var(--fin-text-3)]">Como sai no recibo, com dados de exemplo</figcaption>
        <p className="max-w-[68ch] whitespace-pre-line fin-t-body leading-relaxed text-[var(--fin-text)]">{preencherTexto(texto, EXEMPLOS)}</p>
        {valor.complemento ? <p className="max-w-[68ch] whitespace-pre-line fin-t-caption text-[var(--fin-text-2)]">{valor.complemento}</p> : null}
      </figure>
    </section>
  );
}
