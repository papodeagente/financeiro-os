'use client';

/**
 * Lançar pelo voucher (E7, fechamento). A pessoa envia o voucher (PDF ou
 * foto) ou cola o e-mail da operadora; a IA da agência lê e a ficha da venda
 * abre com o rascunho preenchido (/vendas/lancar?voucher=<hash>). Nada é
 * gravado aqui: só o "Salvar" da ficha grava a venda.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2, ScanText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Callout } from '@/components/fin/Callout';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { Segmentado } from '@/components/fin/Segmentado';
import { cn } from '@/lib/utils';

type Modo = 'arquivo' | 'email';
const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
const ACEITOS = 'application/pdf,image/jpeg,image/png,image/webp';

export default function LancarPeloVoucherPage() {
  const router = useRouter();
  const [modo, setModo] = React.useState<Modo>('arquivo');
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [texto, setTexto] = React.useState('');
  const [lendo, setLendo] = React.useState(false);
  const [erro, setErro] = React.useState<{ mensagem: string; semChave: boolean } | null>(null);
  const [arrastando, setArrastando] = React.useState(false);
  const entrada = React.useRef<HTMLInputElement>(null);

  const pronto = modo === 'arquivo' ? Boolean(arquivo) : texto.trim().length >= 30;

  async function ler() {
    if (!pronto || lendo) return;
    setLendo(true);
    setErro(null);
    try {
      let r: Response;
      if (modo === 'arquivo' && arquivo) {
        const form = new FormData();
        form.append('file', arquivo);
        r = await fetch('/api/vendas/voucher', { method: 'POST', body: form });
      } else {
        r = await fetch('/api/vendas/voucher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto }) });
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.hash) {
        setErro({ mensagem: String(j?.error ?? 'Não deu para ler. Tente de novo ou lance à mão.'), semChave: j?.codigo === 'sem_chave_ia' });
        return;
      }
      router.push(`/vendas/lancar?voucher=${encodeURIComponent(j.hash)}`);
    } catch {
      setErro({ mensagem: 'Sem conexão com o servidor. Tente de novo.', semChave: false });
    } finally {
      setLendo(false);
    }
  }

  function escolher(f: File | null | undefined) {
    if (!f) return;
    setArquivo(f);
    setErro(null);
  }

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={ScanText}
        titulo="Lançar pelo voucher"
        subtitulo="A IA lê o voucher ou o e-mail da operadora e monta a venda. Você confere cada campo na ficha antes de salvar."
        acoesSecundarias={[{ rotulo: 'Lançar à mão', href: '/vendas/lancar' }]}
      />

      <section className={cn(CARTAO, 'flex max-w-3xl flex-col gap-[var(--fin-s-4)] p-[var(--fin-s-5)]')}>
        <Segmentado<Modo>
          rotulo="O que você tem"
          opcoes={[{ valor: 'arquivo', rotulo: 'Voucher em PDF ou foto' }, { valor: 'email', rotulo: 'Texto do e-mail' }]}
          valor={modo}
          onChange={m => { setModo(m); setErro(null); }}
        />

        {modo === 'arquivo' ? (
          <div
            onDragOver={e => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={e => { e.preventDefault(); setArrastando(false); escolher(e.dataTransfer.files?.[0]); }}
            className={cn(
              'flex flex-col items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-dashed px-[var(--fin-s-4)] py-[var(--fin-s-6)] text-center',
              'transition-colors duration-[var(--fin-dur-base)]',
              arrastando ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)]',
            )}
          >
            <FileUp aria-hidden="true" className="size-6 text-[var(--fin-text-3)]" />
            {arquivo ? (
              <p className="fin-t-body-strong text-[var(--fin-text)]">{arquivo.name}</p>
            ) : (
              <p className="fin-t-body text-[var(--fin-text-2)]">Arraste o voucher aqui ou escolha o arquivo.</p>
            )}
            <p className="fin-t-caption text-[var(--fin-text-3)]">PDF até 8MB ou foto (JPG, PNG, WEBP) até 5MB.</p>
            <input ref={entrada} type="file" accept={ACEITOS} className="sr-only" onChange={e => escolher(e.target.files?.[0])} />
            <Button type="button" variant="outline" size="sm" onClick={() => entrada.current?.click()}>
              {arquivo ? 'Trocar arquivo' : 'Escolher arquivo'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor="voucher-email" className="fin-t-body-strong text-[var(--fin-text)]">E-mail da operadora</label>
            <Textarea
              id="voucher-email"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              rows={10}
              maxLength={100_000}
              placeholder="Cole aqui o texto do e-mail de confirmação da reserva."
            />
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              No e-mail colado, o sistema confere se cada trecho que a IA citou está mesmo no texto; o que não estiver fica de fora.
            </p>
          </div>
        )}

        {erro ? (
          erro.semChave ? (
            <Callout tom="info" titulo="Ligue a IA da agência para ler vouchers">
              {erro.mensagem}{' '}
              <Link href="/config/integracoes/ia" className="font-medium text-[var(--fin-accent)] underline-offset-2 hover:underline">Abrir Integração com IA</Link>
            </Callout>
          ) : (
            <Callout tom="negativo" titulo="Não deu para ler">{erro.mensagem}</Callout>
          )
        ) : null}

        <div className="flex flex-col-reverse gap-[var(--fin-s-2)] sm:flex-row sm:items-center sm:justify-between">
          <p className="fin-t-caption text-[var(--fin-text-3)]">Nada é gravado agora. A venda só nasce quando você salva a ficha.</p>
          <Button type="button" onClick={() => { void ler(); }} disabled={!pronto || lendo}>
            {lendo ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {lendo ? 'Lendo o documento…' : 'Ler e montar a venda'}
          </Button>
        </div>
      </section>
    </MolduraDaPagina>
  );
}
