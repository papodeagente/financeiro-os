'use client';

import * as React from 'react';
import { use } from 'react';
import { FileSpreadsheet, FileText, Printer } from 'lucide-react';

import { textoDaCelula, type DocumentoExportado } from '@/lib/exportacao/documento';
import { cn } from '@/lib/utils';

/**
 * Link de leitura de relatório (E7, G3): quem recebeu o e-mail abre sem
 * login e vê só este relatório, como estava no envio. Baixa em Excel ou PDF.
 * Depois da validade, ou se a agência desligar, o link não abre mais.
 */

interface Leitura { titulo: string; agencia: string; criado_em: string; expira_em: string; documento: DocumentoExportado }
type Estado = { tipo: 'carregando' } | { tipo: 'ok'; leitura: Leitura } | { tipo: 'erro'; titulo: string; texto: string };

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const aDireita = (t: string) => t !== 'texto' && t !== 'data';

export default function LeituraDeRelatorioPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [estado, setEstado] = React.useState<Estado>({ tipo: 'carregando' });

  React.useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/leitura/${encodeURIComponent(token)}`, { signal: ac.signal, cache: 'no-store' })
      .then(async r => {
        const corpo = await r.json().catch(() => null);
        if (r.ok) { setEstado({ tipo: 'ok', leitura: corpo as Leitura }); return; }
        if (r.status === 404) setEstado({ tipo: 'erro', titulo: 'Este link não abre mais', texto: 'Ele venceu ou foi desligado pela agência. Peça um link novo a quem mandou o relatório.' });
        else if (r.status === 429) setEstado({ tipo: 'erro', titulo: 'Muitas tentativas', texto: 'Espere alguns minutos e abra o link de novo.' });
        else setEstado({ tipo: 'erro', titulo: 'Não foi possível abrir agora', texto: 'Tente de novo em alguns minutos.' });
      })
      .catch(() => { if (!ac.signal.aborted) setEstado({ tipo: 'erro', titulo: 'Sem conexão', texto: 'Confira a internet e abra o link de novo.' }); });
    return () => ac.abort();
  }, [token]);

  if (estado.tipo === 'carregando') {
    return (
      <main aria-busy="true" className="mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col gap-[var(--fin-s-4)] bg-[var(--fin-bg)] px-[var(--fin-s-4)] py-[var(--fin-s-5)]">
        <span className="block h-7 w-64 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
        <span className="block h-4 w-96 max-w-full animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
        <span className="block h-96 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
        <span className="sr-only" role="status">Abrindo o relatório.</span>
      </main>
    );
  }

  if (estado.tipo === 'erro') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center gap-[var(--fin-s-2)] bg-[var(--fin-bg)] px-[var(--fin-s-5)] py-[var(--fin-s-6)]">
        <h1 className="fin-t-title text-[var(--fin-text)]">{estado.titulo}</h1>
        <p className="fin-t-body text-[var(--fin-text-2)]">{estado.texto}</p>
      </main>
    );
  }

  const { leitura } = estado;
  const doc = leitura.documento;
  const un = doc.dinheiro_em ?? 'reais';
  const baixar = (f: string) => `/api/leitura/${encodeURIComponent(token)}?formato=${f}`;
  const botao = cn('inline-flex h-11 items-center gap-1.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[13px] font-medium text-[var(--fin-text)] transition-colors duration-[var(--fin-dur-rapida)] hover:bg-[var(--fin-surface-2)] lg:h-9', FOCO);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1200px] flex-col gap-[var(--fin-s-4)] bg-[var(--fin-bg)] px-[var(--fin-s-4)] py-[var(--fin-s-5)] lg:px-[var(--fin-s-5)]">
      <header className="flex flex-wrap items-end justify-between gap-[var(--fin-s-3)]">
        <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
          {leitura.agencia ? <p className="fin-t-body text-[var(--fin-text-2)]">{leitura.agencia}</p> : null}
          <h1 className="fin-t-title text-balance text-[var(--fin-text)]">{doc.titulo}</h1>
          {doc.subtitulo ? <p className="fin-t-body text-[var(--fin-text-2)]">{doc.subtitulo}</p> : null}
        </div>
        <nav aria-label="Baixar" className="flex flex-wrap gap-[var(--fin-s-2)]">
          <a className={botao} href={baixar('xlsx')}><FileSpreadsheet aria-hidden="true" className="size-4" /> Excel</a>
          <a className={botao} href={baixar('pdf')}><FileText aria-hidden="true" className="size-4" /> PDF</a>
          <a className={botao} href={baixar('imprimir')} target="_blank" rel="noreferrer"><Printer aria-hidden="true" className="size-4" /> Imprimir</a>
        </nav>
      </header>

      {doc.filtros?.length ? (
        <dl className="flex flex-wrap gap-x-[var(--fin-s-5)] gap-y-[var(--fin-s-1)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
          {doc.filtros.map(f => (
            <div key={`${f.rotulo}:${f.valor}`} className="flex flex-col">
              <dt className="fin-t-caption text-[var(--fin-text-3)]">{f.rotulo}</dt>
              <dd className="fin-t-body text-[var(--fin-text)]">{f.valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]">
        <table className="w-full border-collapse fin-t-body">
          <caption className="sr-only">{doc.titulo}</caption>
          <thead>
            <tr className="border-b border-[var(--fin-border)]">
              {doc.colunas.map((c, i) => (
                <th key={c.id} scope="col" className={cn('whitespace-nowrap px-3 py-2 fin-t-overline text-[var(--fin-text-3)]', aDireita(c.tipo) ? 'text-right' : 'text-left', i === 0 && 'sticky left-0 bg-[var(--fin-surface)] pl-4')}>{c.rotulo}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.linhas.length === 0 ? (
              <tr><td colSpan={doc.colunas.length} className="px-4 py-6 text-[var(--fin-text-2)]">Nada neste período.</td></tr>
            ) : doc.linhas.map((l, li) => (
              <tr key={li} className="border-b border-[var(--fin-border)] last:border-b-0">
                {doc.colunas.map((c, i) => {
                  const negativo = c.tipo === 'dinheiro' && typeof l[c.id] === 'number' && (l[c.id] as number) < 0;
                  return (
                    <td key={c.id} className={cn('px-3 py-2 align-top', aDireita(c.tipo) ? 'whitespace-nowrap text-right tabular-nums' : 'text-left', negativo ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]', i === 0 && 'sticky left-0 bg-[var(--fin-surface)] pl-4 font-medium')}>
                      {textoDaCelula(c, l[c.id], un) || <span className="text-[var(--fin-text-3)]">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {doc.totais && doc.linhas.length ? (
            <tfoot>
              <tr className="border-t-2 border-[var(--fin-border-strong)]">
                {doc.colunas.map((c, i) => {
                  const v = doc.totais![c.id];
                  const texto = i === 0 && (v === null || v === undefined || v === '') ? (doc.rotulo_total ?? 'Total') : textoDaCelula(c, v, un);
                  return <td key={c.id} className={cn('px-3 py-2 font-semibold text-[var(--fin-text)]', aDireita(c.tipo) ? 'whitespace-nowrap text-right tabular-nums' : 'text-left', i === 0 && 'sticky left-0 bg-[var(--fin-surface)] pl-4')}>{texto}</td>;
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {doc.nota ? <p className="fin-t-caption text-[var(--fin-text-2)]">{doc.nota}</p> : null}
      <footer className="fin-t-caption text-[var(--fin-text-3)]">
        Gerado em {quando(leitura.criado_em)}. Este link vale até {quando(leitura.expira_em)} e mostra o relatório como estava no envio.
      </footer>
    </main>
  );
}
