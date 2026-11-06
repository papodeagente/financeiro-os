'use client';

/**
 * Abas da conta a pagar/receber em edição (E7, frente D, 06/11/2026):
 *   - Itens: os produtos da venda, os itens da fatura (ao cliente ou do
 *     fornecedor) ou o que a conta de comissão paga;
 *   - Comissões: as comissões ligadas à conta (vendedores, funções,
 *     fornecedor), conforme o direito de quem olha;
 *   - Anexos: qualquer arquivo (contrato, nota, voucher, planilha), conferido
 *     no servidor pelo conteúdo, com tamanho máximo.
 * A visão unificada (Contas a Pagar/Receber) abre esta mesma janela.
 */
import * as React from 'react';
import Link from 'next/link';
import { FileText, LoaderCircle, Paperclip, Trash2 } from 'lucide-react';

import { Abas } from '@/components/financeiro/faturas/pecas';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { formatarNaMoeda } from '@/lib/cambio';
import { ANEXO_MAX_BYTES, DESCRICAO_DOS_TIPOS, EXTENSOES_DO_ANEXO, type Anexo } from '@/lib/anexos-do-titulo';
import { enderecoDaVenda } from '@/lib/gravar-registro';
import type { OrigemDoTitulo } from '@/lib/titulo-origem-servidor';
import { toast } from '@/lib/toast';
import { cn, formatBRL } from '@/lib/utils';

type Aba = 'itens' | 'comissoes' | 'anexos';
const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const LINHA = 'flex items-start justify-between gap-[var(--fin-s-3)] py-[var(--fin-s-2)]';

function tamanho(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function quando(iso?: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

const valorNa = (v: number, moeda: string) => (moeda && moeda !== 'BRL' ? formatarNaMoeda(v, moeda) : formatBRL(v));

export function PainelDoTitulo({
  tabela, tituloId, onAnexosMudaram,
}: {
  tabela: 'contas_pagar' | 'contas_receber';
  tituloId: string;
  /** A lista de anexos e a versão nova da conta (a tela atualiza o que tem em mãos). */
  onAnexosMudaram?: (anexos: Anexo[], versao: string) => void;
}) {
  const lado = tabela === 'contas_pagar' ? 'pagar' : 'receber';
  const [dados, setDados] = React.useState<OrigemDoTitulo | null>(null);
  const [erro, setErro] = React.useState(false);
  const [aba, setAba] = React.useState<Aba | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [tirar, setTirar] = React.useState<Anexo | null>(null);
  const [tirando, setTirando] = React.useState(false);
  const entrada = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    // Uma conta por montagem: quem usa passa key={id}, então nada a zerar aqui.
    let vivo = true;
    fetch(`/api/titulos/${lado}/${encodeURIComponent(tituloId)}/origem`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: OrigemDoTitulo) => { if (vivo) setDados(d); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [lado, tituloId]);

  const abaAtual: Aba = aba ?? (dados && dados.itens.length > 0 ? 'itens' : dados && dados.comissoes.length > 0 ? 'comissoes' : 'anexos');

  async function enviar(arquivo: File) {
    if (arquivo.size > ANEXO_MAX_BYTES) {
      toast.error('Arquivo grande demais.', `O limite é ${ANEXO_MAX_BYTES / 1024 / 1024} MB por arquivo.`);
      return;
    }
    setEnviando(true);
    try {
      const corpo = new FormData();
      corpo.append('arquivo', arquivo);
      const r = await fetch(`/api/titulos/${lado}/${encodeURIComponent(tituloId)}/anexos`, { method: 'POST', body: corpo });
      const j = (await r.json().catch(() => ({}))) as { error?: string; anexos?: Anexo[]; _versao?: string };
      if (!r.ok || !j.anexos) { toast.error('O arquivo não foi anexado.', j.error ?? 'Tente de novo.'); return; }
      setDados(d => (d ? { ...d, anexos: j.anexos! } : d));
      onAnexosMudaram?.(j.anexos, j._versao ?? '');
      toast.success('Arquivo anexado.', arquivo.name);
    } catch {
      toast.error('Sem conexão com o servidor.', 'O arquivo não foi anexado.');
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  async function confirmarTirar() {
    if (!tirar) return;
    setTirando(true);
    try {
      const r = await fetch(`/api/titulos/${lado}/${encodeURIComponent(tituloId)}/anexos?url=${encodeURIComponent(tirar.url)}`, { method: 'DELETE' });
      const j = (await r.json().catch(() => ({}))) as { error?: string; anexos?: Anexo[]; _versao?: string };
      if (!r.ok || !j.anexos) { toast.error('O anexo não saiu.', j.error ?? 'Tente de novo.'); return; }
      setDados(d => (d ? { ...d, anexos: j.anexos! } : d));
      onAnexosMudaram?.(j.anexos, j._versao ?? '');
      setTirar(null);
    } finally {
      setTirando(false);
    }
  }

  if (erro) {
    return <p className="fin-t-caption text-[var(--fin-text-3)]">Itens, comissões e anexos não puderam ser lidos agora. O resto da conta não muda.</p>;
  }
  if (!dados) {
    return (
      <div className="flex items-center gap-2 fin-t-caption text-[var(--fin-text-3)]" aria-busy="true">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        Lendo itens, comissões e anexos…
      </div>
    );
  }

  const idBase = `titulo-${tituloId}`;
  return (
    <section aria-label="Itens, comissões e anexos" className="flex flex-col gap-[var(--fin-s-3)]">
      <Abas
        rotulo="Itens, comissões e anexos da conta"
        idBase={idBase}
        valor={abaAtual}
        onChange={setAba}
        abas={[
          { id: 'itens', rotulo: 'Itens', contagem: dados.itens.length },
          { id: 'comissoes', rotulo: 'Comissões', contagem: dados.comissoes.length },
          { id: 'anexos', rotulo: 'Anexos', contagem: dados.anexos.length },
        ]}
      />
      <div id={`${idBase}-painel`} role="tabpanel" aria-labelledby={`${idBase}-aba-${abaAtual}`} className="flex flex-col gap-[var(--fin-s-2)]">
        {abaAtual === 'itens' ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                {dados.origem.tipo === 'manual' ? 'Conta lançada à mão: não veio de venda nem de fatura.' : `Origem: ${dados.origem.rotulo}.`}
              </p>
              {dados.origem.venda_id ? (
                <Link href={enderecoDaVenda(dados.origem.venda_id)} className={cn('fin-t-caption rounded-[var(--fin-r-sm)] text-[var(--fin-accent)] underline underline-offset-2', FOCO)}>
                  Abrir a venda
                </Link>
              ) : null}
            </div>
            {dados.itens.length === 0 ? (
              dados.origem.tipo === 'manual' ? null : <p className="fin-t-body text-[var(--fin-text-2)]">A origem desta conta não tem itens guardados.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                {dados.itens.map((i, n) => (
                  <li key={n} className={LINHA}>
                    <span className="flex min-w-0 flex-col">
                      <span className={cn('fin-t-body-strong text-[var(--fin-text)]', i.cancelado && 'line-through decoration-[var(--fin-text-3)]')}>
                        {i.quantidade && i.quantidade > 1 ? `${i.quantidade}× ` : ''}{i.descricao}
                      </span>
                      {i.detalhe || i.cancelado ? (
                        <span className="fin-t-caption text-[var(--fin-text-3)]">{[i.detalhe, i.cancelado ? 'Cancelado' : ''].filter(Boolean).join(' · ')}</span>
                      ) : null}
                    </span>
                    <span className="fin-t-body shrink-0 tabular-nums text-[var(--fin-text)]">{valorNa(i.valor, i.moeda)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}

        {abaAtual === 'comissoes' ? (
          <>
            {dados.comissoes.length === 0 ? (
              <p className="fin-t-body text-[var(--fin-text-2)]">
                {dados.origem.venda_id || dados.origem.tipo === 'comissao' ? 'Nenhuma comissão ligada a esta conta.' : 'Comissões só existem em conta que veio de venda ou de pagamento de comissão.'}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                {dados.comissoes.map((c, n) => (
                  <li key={n} className={LINHA}>
                    <span className="flex min-w-0 flex-col">
                      <span className="fin-t-body-strong text-[var(--fin-text)]">{c.quem}</span>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">{[c.papel, c.descricao].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="fin-t-body tabular-nums text-[var(--fin-text)]">{formatBRL(c.valor)}</span>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">{c.situacao}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {dados.comissoes_ocultas ? (
              <p className="fin-t-caption text-[var(--fin-text-3)]">Parte das comissões não aparece: seu acesso não inclui o ganho da agência ou a comissão da equipe.</p>
            ) : null}
          </>
        ) : null}

        {abaAtual === 'anexos' ? (
          <>
            {dados.anexos.length === 0 ? (
              <p className="fin-t-body text-[var(--fin-text-2)]">Nenhum arquivo anexado. Contrato, nota, voucher ou planilha ficam aqui, junto da conta.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                {dados.anexos.map(a => (
                  <li key={a.url} className={cn(LINHA, 'items-center')}>
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className={cn('flex min-w-0 items-center gap-2 rounded-[var(--fin-r-sm)]', FOCO)}>
                      <FileText aria-hidden="true" className="size-4 shrink-0 text-[var(--fin-text-3)]" />
                      <span className="flex min-w-0 flex-col">
                        <span className="fin-t-body truncate text-[var(--fin-accent)] underline-offset-2 hover:underline">{a.nome}</span>
                        {a.enviado_em || a.tamanho ? (
                          <span className="fin-t-caption text-[var(--fin-text-3)]">{[tamanho(a.tamanho), a.enviado_por, quando(a.enviado_em)].filter(Boolean).join(' · ')}</span>
                        ) : null}
                      </span>
                    </a>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Tirar o anexo ${a.nome}`} onClick={() => setTirar(a)} className="max-lg:size-11">
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-[var(--fin-s-3)]">
              <input
                ref={entrada}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                accept={EXTENSOES_DO_ANEXO.map(e => `.${e}`).join(',')}
                onChange={e => { const f = e.target.files?.[0]; if (f) void enviar(f); }}
              />
              <Button type="button" variant="outline" disabled={enviando} onClick={() => entrada.current?.click()} className="self-start">
                {enviando ? <LoaderCircle aria-hidden="true" data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : <Paperclip aria-hidden="true" data-icon="inline-start" />}
                {enviando ? 'Anexando…' : 'Anexar arquivo'}
              </Button>
              <span className="fin-t-caption text-[var(--fin-text-3)]">{DESCRICAO_DOS_TIPOS}, até {ANEXO_MAX_BYTES / 1024 / 1024} MB.</span>
            </div>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        aberto={tirar !== null}
        onOpenChange={a => { if (!a) setTirar(null); }}
        titulo="Tirar este anexo da conta?"
        oQueVaiAcontecer="O arquivo sai da lista desta conta. O histórico da conta continua registrando que ele esteve aqui."
        detalhes={tirar ? [{ rotulo: 'Arquivo', valor: tirar.nome }] : undefined}
        confirmarRotulo="Tirar anexo"
        tone="destrutivo"
        processando={tirando}
        onConfirmar={() => { void confirmarTirar(); }}
      />
    </section>
  );
}
