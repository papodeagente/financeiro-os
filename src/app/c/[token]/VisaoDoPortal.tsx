'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Copy, ExternalLink, FileText, Mail, MessageCircle, Phone, ShieldCheck } from 'lucide-react';

import type { ItemDoPortal, PortalPublico } from '@/lib/cobranca/portal-regras';
import { dataBR, linhaEmBlocos } from '@/lib/cobranca/regras-telas';
import { cn, formatBRL } from '@/lib/utils';

/**
 * Portal do cliente (05/11/2026): a página que o cliente da agência abre
 * pelo link pessoal, quase sempre no celular. Uma coisa por vez:
 *   1. quanto falta pagar;
 *   2. cada conta com o jeito de pagar (Pix copia e cola, boleto);
 *   3. as pagas, com o recibo;
 *   4. como falar com a agência.
 * Sem login e sem nada além do que é do próprio cliente (o servidor recorta).
 */

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

function useCopiar() {
  const [copiado, setCopiado] = React.useState<string | null>(null);
  const copiar = React.useCallback(async (chave: string, texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(chave);
      window.setTimeout(() => setCopiado(c => (c === chave ? null : c)), 2500);
    } catch {
      // Sem área de transferência (navegador antigo): seleciona para copiar à mão.
      window.prompt('Copie o código abaixo:', texto);
    }
  }, []);
  return { copiado, copiar };
}

function vencimentoEmPalavras(item: ItemDoPortal, hoje: string): string {
  if (!item.vencimento) return 'Sem vencimento';
  if (item.vencimento === hoje) return 'Vence hoje';
  return item.situacao === 'em_atraso' ? `Venceu em ${dataBR(item.vencimento)}` : `Vence em ${dataBR(item.vencimento)}`;
}

function ContaParaPagar({ item, hoje, copiar, copiado, agencia }: {
  item: ItemDoPortal; hoje: string; copiado: string | null;
  copiar: (chave: string, texto: string) => void; agencia: PortalPublico['agencia'];
}) {
  const c = item.cobranca;
  const viva = c && (c.status === 'aberta' || c.status === 'vencida' || c.status === 'emitindo');
  const atrasada = item.situacao === 'em_atraso';
  const chavePix = `pix:${item.ref}`;
  const chaveLinha = `linha:${item.ref}`;
  return (
    <li className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]">
      <div className="flex items-start justify-between gap-[var(--fin-s-3)]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{item.descricao}</span>
          <span className={cn('fin-t-caption tabular-nums', atrasada ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]')}>
            {vencimentoEmPalavras(item, hoje)}{item.parcela ? ` · parcela ${item.parcela}` : ''}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="fin-t-metric-sm tabular-nums text-[var(--fin-text)]">{formatBRL(item.saldo)}</span>
          {item.saldo !== item.valor ? <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">de {formatBRL(item.valor)}</span> : null}
        </div>
      </div>

      {viva && c.status === 'emitindo' ? (
        <p className="fin-t-caption text-[var(--fin-text-2)]">O boleto está sendo gerado. Abra esta página de novo em alguns minutos.</p>
      ) : viva ? (
        <div className="flex flex-col gap-[var(--fin-s-2)]">
          {c.pix_copia_cola ? (
            <>
              <button
                type="button"
                onClick={() => copiar(chavePix, c.pix_copia_cola!)}
                className={cn(
                  'inline-flex h-12 w-full items-center justify-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-accent)] px-4 fin-t-body-strong text-[var(--fin-text-on-fill)] transition-colors duration-[var(--fin-dur-rapida)] hover:bg-[var(--fin-accent-hover)]',
                  FOCO,
                )}
              >
                {copiado === chavePix ? <Check aria-hidden="true" className="size-5" /> : <Copy aria-hidden="true" className="size-5" />}
                {copiado === chavePix ? 'Código Pix copiado' : 'Copiar código Pix'}
              </button>
              <p className="fin-t-caption text-[var(--fin-text-3)]">No app do seu banco, escolha Pix, depois “Pix copia e cola”, e cole o código.</p>
            </>
          ) : null}
          {c.linha_digitavel ? (
            <button
              type="button"
              onClick={() => copiar(chaveLinha, c.linha_digitavel!)}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-left hover:bg-[var(--fin-surface-2)]',
                FOCO,
              )}
            >
              <span className="inline-flex items-center gap-1 fin-t-caption text-[var(--fin-text-2)]">
                {copiado === chaveLinha ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
                {copiado === chaveLinha ? 'Código de barras copiado' : 'Copiar o código de barras do boleto'}
              </span>
              <span className="w-full break-all font-mono text-[13px] tabular-nums text-[var(--fin-text)]">{linhaEmBlocos(c.linha_digitavel)}</span>
            </button>
          ) : null}
          <div className="flex flex-wrap gap-x-[var(--fin-s-4)]">
            {c.url_boleto ? (
              <a href={c.url_boleto} target="_blank" rel="noopener noreferrer" className={cn('inline-flex min-h-11 items-center gap-1 fin-t-body text-[var(--fin-accent)] underline-offset-2 hover:underline', FOCO)}>
                <FileText aria-hidden="true" className="size-4" /> Abrir o boleto (PDF)
              </a>
            ) : null}
            {c.url_fatura ? (
              <a href={c.url_fatura} target="_blank" rel="noopener noreferrer" className={cn('inline-flex min-h-11 items-center gap-1 fin-t-body text-[var(--fin-accent)] underline-offset-2 hover:underline', FOCO)}>
                <ExternalLink aria-hidden="true" className="size-4" /> {c.status === 'vencida' ? 'Pagar com o valor atualizado' : 'Outras formas de pagar'}
              </a>
            ) : null}
          </div>
          {c.status === 'vencida' && !c.url_fatura ? (
            <p className="fin-t-caption text-[var(--fin-text-2)]">Este boleto venceu. Peça à agência a 2ª via com a data nova.</p>
          ) : null}
        </div>
      ) : (
        <p className="fin-t-caption text-[var(--fin-text-2)]">
          O boleto desta conta ainda não foi emitido.{' '}
          {agencia.whatsapp ? (
            <a href={`https://wa.me/${agencia.whatsapp}`} target="_blank" rel="noopener noreferrer" className="text-[var(--fin-accent)] underline underline-offset-2">Peça à agência pelo WhatsApp.</a>
          ) : 'Fale com a agência para combinar como pagar.'}
        </p>
      )}
    </li>
  );
}

export function VisaoDoPortal({ portal, token }: { portal: PortalPublico; token: string }) {
  const { copiado, copiar } = useCopiar();
  const { agencia, cliente } = portal;
  const proxima = portal.em_aberto[0];
  const atrasadas = portal.em_aberto.filter(i => i.situacao === 'em_atraso').length;

  return (
    <main className="min-h-dvh bg-[var(--fin-bg)]">
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-[var(--fin-s-5)] px-[var(--fin-s-4)] pb-[var(--fin-s-6)] pt-[var(--fin-s-4)]">
        <header className="flex items-center gap-[var(--fin-s-3)]">
          {agencia.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- logotipo da agência, endereço de fora
            <img src={agencia.logo} alt="" className="size-10 shrink-0 rounded-[var(--fin-r-md)] object-contain" />
          ) : null}
          <span className="fin-t-body-strong text-[var(--fin-text)]">{agencia.nome}</span>
        </header>

        <section aria-labelledby="t-resumo" className="flex flex-col gap-[var(--fin-s-2)]">
          <h1 id="t-resumo" className="fin-t-title text-[var(--fin-text)]">{cliente.primeiro_nome ? `Olá, ${cliente.primeiro_nome}` : 'Olá'}</h1>
          {portal.em_aberto.length ? (
            <div className="flex flex-col gap-1">
              <span className="fin-t-caption text-[var(--fin-text-3)]">Falta pagar</span>
              <span className="fin-t-resposta text-[var(--fin-text)]">{formatBRL(portal.total_em_aberto)}</span>
              <span className={cn('fin-t-body', atrasadas ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-2)]')}>
                {atrasadas
                  ? `${atrasadas === 1 ? 'Uma conta passou' : `${atrasadas} contas passaram`} do vencimento.`
                  : proxima ? `${portal.em_aberto.length === 1 ? 'Uma conta' : `${portal.em_aberto.length} contas`}; a próxima ${proxima.vencimento === portal.hoje ? 'vence hoje' : `vence em ${dataBR(proxima.vencimento)}`}.` : null}
              </span>
            </div>
          ) : (
            <p className="inline-flex items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-positive)]">
              <Check aria-hidden="true" className="size-5" /> Tudo em dia: nenhuma conta em aberto.
            </p>
          )}
        </section>

        {portal.em_aberto.length ? (
          <section aria-labelledby="t-pagar" className="flex flex-col gap-[var(--fin-s-3)]">
            <h2 id="t-pagar" className="fin-t-subhead text-[var(--fin-text)]">Para pagar</h2>
            <ul className="flex flex-col gap-[var(--fin-s-3)]">
              {portal.em_aberto.map(i => (
                <ContaParaPagar key={i.ref} item={i} hoje={portal.hoje} copiar={copiar} copiado={copiado} agencia={agencia} />
              ))}
            </ul>
            <p className="fin-t-caption text-[var(--fin-text-3)]">Depois de pagar, a conta aparece como paga em alguns minutos (o boleto pode levar até 3 dias úteis).</p>
          </section>
        ) : null}

        {portal.pagas.length ? (
          <section aria-labelledby="t-pagas" className="flex flex-col gap-[var(--fin-s-3)]">
            <h2 id="t-pagas" className="fin-t-subhead text-[var(--fin-text)]">Pagas</h2>
            <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]">
              {portal.pagas.map(i => (
                <li key={i.ref} className="flex items-center justify-between gap-[var(--fin-s-3)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate fin-t-body text-[var(--fin-text)]">{i.descricao}{i.parcela ? ` · ${i.parcela}` : ''}</span>
                    <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{formatBRL(i.valor)}{i.pago_em ? ` · paga em ${dataBR(i.pago_em)}` : ''}</span>
                  </div>
                  {i.tem_recibo ? (
                    <Link
                      href={`/c/${encodeURIComponent(token)}/recibo/${encodeURIComponent(i.ref)}`}
                      className={cn('inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[var(--fin-r-md)] px-2 fin-t-body text-[var(--fin-accent)] hover:bg-[var(--fin-surface-2)]', FOCO)}
                    >
                      <FileText aria-hidden="true" className="size-4" /> Recibo
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="flex flex-col gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-4)]">
          {agencia.whatsapp || agencia.telefone || agencia.email ? (
            <div className="flex flex-col gap-1">
              <span className="fin-t-body-strong text-[var(--fin-text)]">Dúvidas? Fale com {agencia.nome}</span>
              <div className="flex flex-wrap gap-x-[var(--fin-s-4)]">
                {agencia.whatsapp ? (
                  <a href={`https://wa.me/${agencia.whatsapp}`} target="_blank" rel="noopener noreferrer" className={cn('inline-flex min-h-11 items-center gap-1 fin-t-body text-[var(--fin-accent)]', FOCO)}>
                    <MessageCircle aria-hidden="true" className="size-4" /> WhatsApp
                  </a>
                ) : null}
                {agencia.telefone ? (
                  <a href={`tel:${agencia.telefone.replace(/[^\d+]/g, '')}`} className={cn('inline-flex min-h-11 items-center gap-1 fin-t-body text-[var(--fin-accent)]', FOCO)}>
                    <Phone aria-hidden="true" className="size-4" /> {agencia.telefone}
                  </a>
                ) : null}
                {agencia.email ? (
                  <a href={`mailto:${agencia.email}`} className={cn('inline-flex min-h-11 items-center gap-1 break-all fin-t-body text-[var(--fin-accent)]', FOCO)}>
                    <Mail aria-hidden="true" className="size-4" /> {agencia.email}
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
          <p className="flex items-start gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-3)]">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              Este link é pessoal{cliente.documento ? ` (CPF/CNPJ ${cliente.documento})` : ''}: não repasse. O pagamento vai direto para a conta da agência.
            </span>
          </p>
        </footer>
      </div>
    </main>
  );
}

