'use client';

import * as React from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { DocumentoExportado } from '@/lib/exportacao/documento';

/**
 * Exportar (E7, G3): o mesmo botão em toda lista e todo relatório.
 * "Excel (.xlsx)", "PDF" e "Imprimir". Dois jeitos de montar o arquivo:
 *  - `endereco(formato)`: a rota da lista lê o filtro inteiro no servidor
 *    (contas, extrato, relatórios de vendas) e devolve o arquivo;
 *  - `documento()`: a tela já tem o relatório montado (DRE, fluxo de caixa)
 *    e manda para POST /api/exportacao.
 * Nos dois, o servidor confere o direito "Baixar em Excel e PDF" e tira as
 * colunas do ganho da agência de quem não pode vê-las. Sem o direito, o
 * botão nem aparece.
 */

export type FormatoDoBotao = 'xlsx' | 'pdf' | 'imprimir';

let direitosEmCurso: Promise<Record<string, boolean>> | null = null;
function lerDireitos(): Promise<Record<string, boolean>> {
  direitosEmCurso ??= fetch('/api/permissoes/minhas')
    .then(r => (r.ok ? r.json() : null))
    .then((c: { acoes?: Record<string, boolean> } | null) => c?.acoes ?? {})
    .catch(() => ({}));
  return direitosEmCurso;
}

/** Pode exportar? Antes de saber, mostra (o servidor recusa o que não puder). */
export function usePodeExportar(): boolean {
  const [pode, setPode] = React.useState(true);
  React.useEffect(() => {
    let vivo = true;
    void lerDireitos().then(a => { if (vivo) setPode(a.exportar !== false); });
    return () => { vivo = false; };
  }, []);
  return pode;
}

function nomeDaResposta(r: Response, padrao: string): string {
  const cd = r.headers.get('Content-Disposition') ?? '';
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  if (utf) { try { return decodeURIComponent(utf); } catch { /* segue */ } }
  return /filename="([^"]+)"/.exec(cd)?.[1] ?? padrao;
}

/** Baixa ou abre o arquivo. Devolve a mensagem de erro, ou null. */
export async function baixarExportacao(
  pedido: { endereco: string } | { documento: DocumentoExportado; origem: string },
  formato: FormatoDoBotao,
): Promise<string | null> {
  // A janela da impressão abre já no clique (o navegador bloqueia janela aberta depois de esperar).
  const janela = formato === 'imprimir' ? window.open('', '_blank') : null;
  try {
    const r = 'endereco' in pedido
      ? await fetch(pedido.endereco, { cache: 'no-store' })
      : await fetch('/api/exportacao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formato, origem: pedido.origem, documento: pedido.documento }),
      });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      janela?.close();
      return (j && typeof j.error === 'string' ? j.error : null) ?? 'Não foi possível gerar o arquivo.';
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    if (janela) {
      janela.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeDaResposta(r, formato === 'xlsx' ? 'relatorio.xlsx' : 'relatorio.pdf');
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return null;
  } catch {
    janela?.close();
    return 'Sem conexão com o servidor. Tente de novo.';
  }
}

const OPCOES: Array<{ formato: FormatoDoBotao; rotulo: string; dica: string; icone: typeof FileSpreadsheet }> = [
  { formato: 'xlsx', rotulo: 'Excel (.xlsx)', dica: 'Planilha com os números para somar', icone: FileSpreadsheet },
  { formato: 'pdf', rotulo: 'PDF', dica: 'Para guardar ou mandar ao contador', icone: FileText },
  { formato: 'imprimir', rotulo: 'Imprimir', dica: 'Abre o PDF já na impressão', icone: Printer },
];

export interface BotaoExportarProps {
  /** Rota que devolve o arquivo com o filtro aplicado (lista lida no servidor). */
  endereco?: (formato: FormatoDoBotao) => string;
  /** O relatório já montado na tela (vai para POST /api/exportacao). */
  documento?: () => DocumentoExportado | Promise<DocumentoExportado>;
  /** Nome da tela na auditoria (ex.: "dre"). */
  origem: string;
  desabilitado?: boolean;
  /** Já sabido pela tela; sem ele, o botão pergunta ao servidor. */
  podeExportar?: boolean;
  tamanho?: 'sm' | 'default';
  className?: string;
}

export function BotaoExportar({ endereco, documento, origem, desabilitado, podeExportar, tamanho = 'sm', className }: BotaoExportarProps) {
  const consultado = usePodeExportar();
  const pode = podeExportar ?? consultado;
  const [aberto, setAberto] = React.useState(false);
  const [gerando, setGerando] = React.useState<FormatoDoBotao | null>(null);
  const caixa = React.useRef<HTMLDivElement>(null);
  const gatilho = React.useRef<HTMLButtonElement>(null);
  const idMenu = React.useId();

  React.useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    caixa.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  if (!pode) return null;

  async function escolher(formato: FormatoDoBotao) {
    setAberto(false);
    setGerando(formato);
    try {
      const pedido = endereco ? { endereco: endereco(formato) } : documento ? { documento: await documento(), origem } : null;
      if (!pedido) return;
      const erro = await baixarExportacao(pedido, formato);
      if (erro) toast.error('Não foi possível exportar.', erro);
    } catch (e) {
      toast.error('Não foi possível exportar.', e instanceof Error ? e.message : '');
    } finally {
      setGerando(null);
    }
  }

  function teclas(e: React.KeyboardEvent<HTMLDivElement>) {
    const itens = [...(caixa.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = itens.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); setAberto(false); gatilho.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); itens[(i + 1) % itens.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); itens[(i - 1 + itens.length) % itens.length]?.focus(); }
    else if (e.key === 'Tab') setAberto(false);
  }

  return (
    <div ref={caixa} className={cn('relative inline-flex', className)} onKeyDown={teclas}>
      <Button
        ref={gatilho}
        type="button"
        variant="outline"
        size={tamanho}
        disabled={desabilitado || gerando !== null}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idMenu : undefined}
        onClick={() => setAberto(v => !v)}
        className={tamanho === 'sm' ? 'h-11 gap-[var(--fin-s-2)] lg:h-9' : 'gap-[var(--fin-s-2)]'}
      >
        <Download aria-hidden="true" className="size-4" />
        {gerando ? (gerando === 'imprimir' ? 'Preparando…' : 'Gerando arquivo…') : 'Exportar'}
        <ChevronDown aria-hidden="true" className="size-3.5 text-[var(--fin-text-3)]" />
      </Button>
      {aberto ? (
        <div
          id={idMenu}
          role="menu"
          aria-label="Exportar"
          className="absolute right-0 top-full z-[var(--fin-z-popover)] mt-1 flex w-64 flex-col gap-0.5 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-1 shadow-[var(--fin-e1)]"
        >
          {OPCOES.map(o => (
            <button
              key={o.formato}
              type="button"
              role="menuitem"
              onClick={() => { void escolher(o.formato); }}
              className="flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-[var(--fin-s-2)] py-[var(--fin-s-2)] text-left outline-none transition-colors duration-[var(--fin-dur-rapida)] hover:bg-[var(--fin-surface-2)] focus-visible:bg-[var(--fin-surface-2)]"
            >
              <o.icone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-2)]" />
              <span className="flex flex-col">
                <span className="fin-t-body text-[var(--fin-text)]">{o.rotulo}</span>
                <span className="fin-t-caption text-[var(--fin-text-3)]">{o.dica}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default BotaoExportar;
