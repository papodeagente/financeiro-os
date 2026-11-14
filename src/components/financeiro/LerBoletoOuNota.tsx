'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileText, ImageIcon, Loader2, ScanText, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ROTULO_DO_TIPO, type RespostaDaLeitura } from '@/lib/leitura-documento';
import { cn } from '@/lib/utils';

/**
 * "Ler boleto ou nota" (05/11/2026): solta o PDF ou a foto, o servidor lê
 * e devolve os campos para a pessoa conferir. NADA é salvo aqui; quem aplica
 * a leitura no formulário é a tela, e quem salva é o "Criar conta".
 *
 * Estados: pronto para receber (com arrastar por cima), lendo, erro e lido.
 * No lido, mostra o arquivo e o que a tela pendurar em `children`.
 */

const ACEITOS = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
const TIPOS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_PDF = 8 * 1024 * 1024;
const MAX_FOTO = 5 * 1024 * 1024;

type Erro = { mensagem: string; semChave: boolean };

export type LerBoletoOuNotaProps = {
  resposta: RespostaDaLeitura | null;
  onLido: (r: RespostaDaLeitura) => void;
  onDescartar: () => void;
  desabilitado?: boolean;
  children?: React.ReactNode;
};

function conferirArquivo(f: File): string | null {
  if (!TIPOS.has(f.type)) return 'Aceito PDF ou foto (JPG, PNG ou WEBP).';
  if (f.type === 'application/pdf' && f.size > MAX_PDF) return 'O PDF tem mais de 8MB. Envie uma versão menor ou uma foto.';
  if (f.type !== 'application/pdf' && f.size > MAX_FOTO) return 'A foto tem mais de 5MB. Tire outra com menos resolução ou envie o PDF.';
  return null;
}

export function LerBoletoOuNota({ resposta, onLido, onDescartar, desabilitado = false, children }: LerBoletoOuNotaProps) {
  const [lendo, setLendo] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<Erro | null>(null);
  const [arrastando, setArrastando] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const controle = React.useRef<AbortController | null>(null);
  const idTitulo = React.useId();

  React.useEffect(() => () => controle.current?.abort(), []);

  // Arquivo solto um pouco fora da área abriria o PDF na aba e levaria o
  // formulário junto. Enquanto o bloco existe, soltar fora não faz nada.
  React.useEffect(() => {
    const segurar = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', segurar);
    window.addEventListener('drop', segurar);
    return () => {
      window.removeEventListener('dragover', segurar);
      window.removeEventListener('drop', segurar);
    };
  }, []);

  async function ler(arquivo: File) {
    const recusa = conferirArquivo(arquivo);
    if (recusa) {
      setErro({ mensagem: recusa, semChave: false });
      return;
    }
    setErro(null);
    setLendo(arquivo.name);
    const c = new AbortController();
    controle.current = c;
    try {
      const corpo = new FormData();
      corpo.append('file', arquivo);
      const r = await fetch('/api/leitura-documento', { method: 'POST', body: corpo, signal: c.signal });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro({ mensagem: json.error || 'Não foi possível ler o arquivo.', semChave: json.codigo === 'sem_chave_ia' });
        return;
      }
      onLido(json as RespostaDaLeitura);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setErro({ mensagem: 'Sem conexão com o servidor. Tente de novo.', semChave: false });
    } finally {
      if (controle.current === c) controle.current = null;
      setLendo(null);
    }
  }

  function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    // Limpa já: escolher o MESMO arquivo de novo depois de um erro não
    // dispararia evento nenhum.
    e.target.value = '';
    if (f) void ler(f);
  }

  function soltar(e: React.DragEvent) {
    e.preventDefault();
    setArrastando(false);
    if (desabilitado || lendo) return;
    const f = e.dataTransfer.files?.[0];
    if (f) void ler(f);
  }

  const alvoDeSoltar = {
    onDragOver: (e: React.DragEvent) => {
      if (desabilitado || lendo || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setArrastando(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false);
    },
    onDrop: soltar,
  };

  function cancelar() {
    controle.current?.abort();
    setLendo(null);
  }

  const seletor = (
    <input
      ref={inputRef}
      type="file"
      accept={ACEITOS}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={escolher}
    />
  );

  // --- Lido ----------------------------------------------------------------
  if (resposta && !lendo) {
    const { leitura, anexo } = resposta;
    const Icone = anexo.url.endsWith('.pdf') ? FileText : ImageIcon;
    const detalhe = [
      ROTULO_DO_TIPO[leitura.tipo_documento],
      leitura.boleto?.emissor,
      resposta.repetida ? 'lido antes, sem nova leitura' : null,
    ].filter(Boolean).join(' · ');
    return (
      <section
        aria-labelledby={idTitulo}
        {...alvoDeSoltar}
        className={cn(
          'flex flex-col gap-3 rounded-[var(--fin-r-lg)] border p-3 sm:p-4',
          'transition-[background-color,border-color] duration-[var(--fin-dur-base)] ease-[var(--fin-curva)]',
          arrastando ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)] bg-[var(--fin-surface)]',
        )}
      >
        {seletor}
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--fin-r-md)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]">
            <Icone className="size-4" aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h3 id={idTitulo} className="fin-t-body-strong text-[var(--fin-text)]">
              Lido de{' '}
              <a
                href={anexo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[var(--fin-r-sm)] text-[var(--fin-accent)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
              >
                <span className="break-all">{anexo.nome}</span>
              </a>
            </h3>
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              {arrastando ? 'Solte para ler este arquivo no lugar.' : `${detalhe}. Vai como anexo quando você criar a conta.`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="sm" disabled={desabilitado} onClick={() => inputRef.current?.click()}>
              Ler outro
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={desabilitado}
              onClick={onDescartar}
              aria-label="Descartar a leitura e tirar o arquivo dos anexos"
              title="Descartar a leitura"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
        {erro ? <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{erro.mensagem}</p> : null}
        {children}
      </section>
    );
  }

  // --- Pronto, lendo ou erro -------------------------------------------------
  return (
    <section
      aria-labelledby={idTitulo}
      aria-busy={lendo ? true : undefined}
      {...alvoDeSoltar}
      className={cn(
        'flex flex-col gap-3 rounded-[var(--fin-r-lg)] border border-dashed p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4',
        'transition-[background-color,border-color] duration-[var(--fin-dur-base)] ease-[var(--fin-curva)]',
        arrastando
          ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]'
          : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)]',
      )}
    >
      {seletor}
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--fin-r-md)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]">
          {lendo ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanText className="size-4" aria-hidden />}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={idTitulo} className="fin-t-body-strong text-[var(--fin-text)]">
            {lendo ? 'Lendo o documento…' : 'Ler boleto ou nota'}
          </h3>
          <p className="fin-t-caption text-[var(--fin-text-3)]" aria-live="polite">
            {lendo
              ? <><span className="break-all">{lendo}</span>. Costuma levar de 5 a 20 segundos.</>
              : arrastando
                ? 'Solte para ler.'
                : 'Solte aqui o PDF ou a foto do boleto, da nota ou da fatura. Os campos são preenchidos para você conferir antes de criar a conta.'}
          </p>
          {erro && !lendo ? (
            <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">
              {erro.mensagem}
              {erro.semChave ? (
                <>
                  {' '}
                  <Link
                    href="/config/integracoes/ia"
                    className="rounded-[var(--fin-r-sm)] text-[var(--fin-accent)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
                  >
                    Abrir Integração com IA
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
      {lendo ? (
        <Button type="button" variant="ghost" size="sm" onClick={cancelar} className="self-start sm:self-center">
          Cancelar
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={desabilitado}
          onClick={() => inputRef.current?.click()}
          className="self-start sm:self-center"
        >
          {erro ? 'Tentar outro arquivo' : 'Escolher arquivo'}
        </Button>
      )}
    </section>
  );
}

export default LerBoletoOuNota;
