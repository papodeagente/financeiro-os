'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Copy, ExternalLink, Link2, Printer, ReceiptText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Money } from '@/components/fin/Money';
import { StatusChip } from '@/components/fin/StatusChip';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { usePermissoes } from '@/app/financeiro-ag/contas/useContas';
import {
  api, apiDoPortal, chaveDeIdempotencia, ErroDaCobranca, type Cobranca, type EstadoDoLinkDoPortal,
} from '@/lib/cobranca/contrato-telas';
import {
  acoesDaCobranca, cobrancaViva, dataBR, linhaEmBlocos, mensagemDeErro, nomeDoProvedor, ROTULO_DO_TIPO,
} from '@/lib/cobranca/regras-telas';
import { num, round2 } from '@/lib/money';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

import { EmitirCobrancas, type ContaParaEmitir } from './EmitirCobrancas';
import { ResolverPendencia } from './ResolverPendencia';
import { copiarTexto, useAcoesDaCobranca } from './useAcoesDaCobranca';

/**
 * Bloco "Cobrança" da conta a receber (05/11/2026). Aparece na janela da
 * conta (editar) e na janela "Cobrar" da lista de Contas a receber.
 *
 *   · sem cobrança: "Boleto não emitido" e o botão para emitir (com prévia);
 *   · com cobrança: situação, vencimento, valor, linha digitável e Pix para
 *     copiar, e as ações (abrir, 2ª via, enviar, cancelar), cada uma com
 *     confirmação quando grava;
 *   · conta recebida: o recibo para imprimir;
 *   · o link do portal do cliente (criar, copiar, revogar).
 */

export interface ContaDoBloco {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  descricao: string;
  status: string;
  valor_final: number;
  valor_recebido: number | null;
  data_vencimento: string;
}

const SECAO = 'flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]';
const BOTAO = 'h-11 gap-[var(--fin-s-2)] lg:h-9';

function erroLegivel(e: unknown): string {
  if (e instanceof ErroDaCobranca) return mensagemDeErro(e.codigo, e.message, e.status);
  return mensagemDeErro(null, e instanceof Error ? e.message : '');
}

function CampoParaCopiar({ rotulo, valor, exibicao, oQue }: { rotulo: string; valor: string; exibicao?: string; oQue: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="fin-t-caption text-[var(--fin-text-3)]">{rotulo}</span>
      <div className="flex min-w-0 items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] py-1 pl-[var(--fin-s-3)] pr-1">
        <code className="min-w-0 grow truncate font-mono text-[13px] tabular-nums text-[var(--fin-text)]" title={valor}>{exibicao ?? valor}</code>
        <Button type="button" variant="ghost" size="sm" onClick={() => { void copiarTexto(valor, oQue); }} className="h-11 shrink-0 gap-1 lg:h-8">
          <Copy aria-hidden="true" className="size-3.5" /> Copiar
        </Button>
      </div>
    </div>
  );
}

function PortalDoCliente({ clienteId, podeEditar }: { clienteId: string; podeEditar: boolean }) {
  const [estado, setEstado] = React.useState<EstadoDoLinkDoPortal | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [confirmar, setConfirmar] = React.useState<'novo' | 'revogar' | null>(null);

  React.useEffect(() => {
    let vivo = true;
    apiDoPortal.estado(clienteId).then(e => { if (vivo) setEstado(e); }).catch(e => { if (vivo) setErro(erroLegivel(e)); });
    return () => { vivo = false; };
  }, [clienteId]);

  async function criar() {
    setOcupado(true);
    try {
      const e = await apiDoPortal.criar(clienteId);
      setEstado(e);
      setConfirmar(null);
      if (e.url) await copiarTexto(e.url, 'Link do portal');
    } catch (e) {
      toast.error('Não foi possível criar o link.', erroLegivel(e));
    } finally {
      setOcupado(false);
    }
  }

  async function revogar() {
    setOcupado(true);
    try {
      setEstado(await apiDoPortal.revogar(clienteId));
      setConfirmar(null);
      toast.success('Link revogado', 'Quem tinha o link não consegue mais abrir.');
    } catch (e) {
      toast.error('Não foi possível revogar.', erroLegivel(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] pt-[var(--fin-s-3)]">
      <div className="flex flex-col gap-0.5">
        <span className="fin-t-body-strong text-[var(--fin-text)]">Portal do cliente</span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">
          Um link pessoal onde o cliente vê o que tem em aberto, paga por boleto ou Pix e baixa os recibos. Sem senha.
        </span>
      </div>
      {erro ? <p className="fin-t-caption text-[var(--fin-text-3)]">{erro}</p> : null}
      {estado?.ativo ? (
        <>
          {estado.url ? <CampoParaCopiar rotulo="Link pessoal" valor={estado.url} oQue="Link do portal" /> : (
            <p className="fin-t-caption text-[var(--fin-text-2)]">O link está ativo. Para mandar de novo, gere um link novo (o anterior para de abrir).</p>
          )}
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            Criado em {dataBR(estado.criado_em)}{estado.acessos > 0 ? ` · aberto ${estado.acessos} ${estado.acessos === 1 ? 'vez' : 'vezes'}, a última em ${dataBR(estado.ultimo_acesso_em)}` : ' · ainda não foi aberto'}
          </p>
          {podeEditar ? (
            <div className="flex flex-wrap gap-[var(--fin-s-2)]">
              <Button type="button" variant="outline" size="sm" className={BOTAO} disabled={ocupado} onClick={() => setConfirmar('novo')}>
                <Link2 aria-hidden="true" className="size-4" /> Gerar link novo
              </Button>
              <Button type="button" variant="ghost" size="sm" className={cn(BOTAO, 'text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]')} disabled={ocupado} onClick={() => setConfirmar('revogar')}>
                Revogar link
              </Button>
            </div>
          ) : null}
        </>
      ) : estado && podeEditar ? (
        <div>
          <Button type="button" variant="outline" size="sm" className={BOTAO} disabled={ocupado} onClick={() => { void criar(); }}>
            <Link2 aria-hidden="true" className="size-4" /> {ocupado ? 'Criando…' : 'Criar e copiar o link'}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        aberto={confirmar !== null}
        onOpenChange={a => { if (!a) setConfirmar(null); }}
        titulo={confirmar === 'revogar' ? 'Revogar o link do portal?' : 'Gerar um link novo?'}
        oQueVaiAcontecer={confirmar === 'revogar'
          ? 'O link para de abrir na hora, para qualquer pessoa. Dá para criar outro depois.'
          : 'O link atual para de abrir e um novo é criado e copiado. Mande o novo ao cliente.'}
        confirmarRotulo={confirmar === 'revogar' ? 'Revogar' : 'Gerar link novo'}
        voltarRotulo="Voltar"
        tone={confirmar === 'revogar' ? 'destrutivo' : 'padrao'}
        processando={ocupado}
        onConfirmar={() => (confirmar === 'revogar' ? revogar() : criar())}
      />
    </div>
  );
}

export function BlocoDeCobranca({ conta, onMudou }: { conta: ContaDoBloco; onMudou?: () => void }) {
  const pode = usePermissoes();
  const podeEmitir = pode('gerar_boletos');
  const [cobrancas, setCobrancas] = React.useState<Cobranca[] | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [versao, setVersao] = React.useState(0);
  const [emitir, setEmitir] = React.useState<ContaParaEmitir[] | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    setErro(null);
    api.daConta(conta.id, ac.signal)
      .then(r => setCobrancas(r.cobrancas))
      .catch(e => { if (!ac.signal.aborted) { setCobrancas([]); setErro(erroLegivel(e)); } });
    return () => ac.abort();
  }, [conta.id, versao]);

  const recarregar = React.useCallback(() => { setVersao(v => v + 1); onMudou?.(); }, [onMudou]);
  const recebida = conta.status === 'RECEBIDO';
  const cancelada = conta.status === 'CANCELADO';
  const saldo = round2(num(conta.valor_final) - num(conta.valor_recebido));
  const contaParaEmitir: ContaParaEmitir = {
    id: conta.id, tipo: 'receber', situacao: recebida ? 'liquidado' : cancelada ? 'cancelado' : 'em_aberto',
    saldo, pessoa: conta.cliente_nome, cliente_id: conta.cliente_id, vencimento: conta.data_vencimento, descricao: conta.descricao,
  };
  const { executar, dialogos } = useAcoesDaCobranca({ onMudou: recarregar, onEmitirDeNovo: () => setEmitir([contaParaEmitir]) });
  const [pendencia, setPendencia] = React.useState<string | null>(null);

  // Link de pagamento (E7): o cliente escolhe como pagar na página do provedor (Asaas: Pix, boleto ou cartão).
  const [link, setLink] = React.useState<{ aberto: boolean; gravando: boolean; erro: string | null }>({ aberto: false, gravando: false, erro: null });
  const chaveDoLink = React.useRef('');
  function abrirLink() {
    chaveDoLink.current = chaveDeIdempotencia();
    setLink({ aberto: true, gravando: false, erro: null });
  }
  async function gerarLink() {
    setLink(l => ({ ...l, gravando: true, erro: null }));
    try {
      const previa = await api.previaDoLink(conta.id);
      const item = previa.itens[0];
      if (!item?.ok) { setLink(l => ({ ...l, gravando: false, erro: item?.motivo ?? 'Esta conta não pode ganhar link agora.' })); return; }
      const c = await api.criarLink(conta.id, previa.assinatura, chaveDoLink.current);
      setLink({ aberto: false, gravando: false, erro: null });
      if (c.url_link) await copiarTexto(c.url_link, 'Link de pagamento');
      else toast.info('Link a caminho', 'O provedor ainda está criando a página. Atualize em instantes.');
      recarregar();
    } catch (e) {
      setLink(l => ({ ...l, gravando: false, erro: erroLegivel(e) }));
    }
  }

  const atual = cobrancas?.find(c => cobrancaViva(c.status)) ?? cobrancas?.find(c => c.status === 'paga') ?? null;
  const anteriores = (cobrancas ?? []).filter(c => c !== atual);
  const acoes = atual ? acoesDaCobranca(atual, { emitir: podeEmitir }) : [];
  const secundarias = acoes.filter(a => !['copiar_linha', 'copiar_pix'].includes(a.id));

  return (
    <section aria-labelledby={`cobranca-${conta.id}`} className={SECAO}>
      <div className="flex flex-wrap items-center justify-between gap-[var(--fin-s-2)]">
        <h3 id={`cobranca-${conta.id}`} className="fin-t-subhead text-[var(--fin-text)]">Cobrança</h3>
        {atual ? <StatusChip valor={atual.status} dominio="cobranca" dot /> : null}
      </div>

      {cobrancas === null ? (
        <div aria-busy="true" className="flex flex-col gap-[var(--fin-s-2)]">
          <span className="block h-5 w-40 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-11 animate-pulse rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
          <span className="sr-only" role="status">Lendo a cobrança.</span>
        </div>
      ) : atual ? (
        <div className="flex flex-col gap-[var(--fin-s-3)]">
          <dl className="grid grid-cols-2 gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-2)] fin-t-body sm:grid-cols-3">
            <div className="flex flex-col"><dt className="fin-t-caption text-[var(--fin-text-3)]">Vencimento</dt><dd className="tabular-nums text-[var(--fin-text)]">{dataBR(atual.vencimento)}</dd></div>
            <div className="flex flex-col"><dt className="fin-t-caption text-[var(--fin-text-3)]">Valor</dt><dd><Money valor={atual.valor} size="body" align="esquerda" estado="ok" /></dd></div>
            <div className="flex flex-col"><dt className="fin-t-caption text-[var(--fin-text-3)]">Como paga</dt><dd className="text-[var(--fin-text)]">{ROTULO_DO_TIPO[atual.tipo]} · {nomeDoProvedor(atual.provedor)}</dd></div>
          </dl>
          {atual.status === 'paga' ? (
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              {atual.valor_pago ? <>Entrou <Money valor={atual.valor_pago} size="caption" align="esquerda" className="inline-block min-w-0" estado="ok" /></> : 'Paga'}
              {atual.pago_em ? ` em ${dataBR(atual.pago_em)}` : ''}. A conta foi baixada sozinha pelo aviso do provedor.
            </p>
          ) : null}
          {cobrancaViva(atual.status) && atual.linha_digitavel ? (
            <CampoParaCopiar rotulo="Linha digitável" valor={atual.linha_digitavel} exibicao={linhaEmBlocos(atual.linha_digitavel)} oQue="Linha digitável" />
          ) : null}
          {cobrancaViva(atual.status) && atual.pix_copia_cola ? (
            <CampoParaCopiar rotulo="Pix copia e cola" valor={atual.pix_copia_cola} oQue="Código Pix" />
          ) : null}
          {cobrancaViva(atual.status) && atual.tipo === 'link' && atual.url_link ? (
            <CampoParaCopiar rotulo="Link de pagamento" valor={atual.url_link} oQue="Link de pagamento" />
          ) : null}
          {atual.pendencia ? (
            <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] p-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-warning-text)]">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>O cliente pagou pelo provedor, mas a baixa não entrou sozinha.</span>
              </p>
              {podeEmitir ? (
                <Button type="button" variant="outline" size="sm" className={cn(BOTAO, 'shrink-0')} onClick={() => setPendencia(atual.id)}>
                  Resolver
                </Button>
              ) : null}
            </div>
          ) : null}
          {atual.status === 'emitindo' ? (
            <p role="status" className="fin-t-caption text-[var(--fin-text-2)]">O provedor está gerando o boleto e o Pix. Atualize em instantes.</p>
          ) : null}
          {secundarias.length ? (
            <div className="flex flex-wrap gap-[var(--fin-s-2)]">
              {secundarias.map(a => (
                <Button
                  key={a.id}
                  type="button"
                  variant={a.destrutiva ? 'ghost' : 'outline'}
                  size="sm"
                  disabled={a.bloqueio !== null}
                  title={a.bloqueio ?? undefined}
                  onClick={() => executar(a.id, atual)}
                  className={cn(BOTAO, a.destrutiva && 'text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]')}
                >
                  {a.id === 'abrir_boleto' || a.id === 'abrir_fatura' ? <ExternalLink aria-hidden="true" className="size-4" /> : null}
                  {a.rotulo}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--fin-s-3)]">
          {erro ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}
          {recebida ? (
            <p className="fin-t-body text-[var(--fin-text-2)]">Conta recebida sem boleto da agência.</p>
          ) : cancelada ? (
            <p className="fin-t-body text-[var(--fin-text-2)]">Conta cancelada: não há o que cobrar.</p>
          ) : (
            <>
              <p className="fin-t-body text-[var(--fin-text-2)]">
                <span className="fin-t-body-strong text-[var(--fin-text)]">Boleto não emitido.</span>{' '}
                Emita o boleto ou o Pix pelo provedor da agência: quando o cliente pagar, esta conta é baixada sozinha.
              </p>
              {podeEmitir ? (
                <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                  <Button type="button" size="sm" className={BOTAO} disabled={saldo <= 0} onClick={() => setEmitir([contaParaEmitir])}>
                    <ReceiptText aria-hidden="true" className="size-4" /> Emitir boleto ou Pix
                  </Button>
                  <Button type="button" variant="outline" size="sm" className={BOTAO} disabled={saldo <= 0} onClick={abrirLink}>
                    <Link2 aria-hidden="true" className="size-4" /> Gerar link de pagamento
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {anteriores.length > 0 ? (
        <details className="group fin-t-caption text-[var(--fin-text-3)]">
          <summary className="cursor-pointer select-none py-1 text-[var(--fin-text-2)] hover:text-[var(--fin-text)]">
            {anteriores.length === 1 ? '1 cobrança anterior' : `${anteriores.length} cobranças anteriores`}
          </summary>
          <ul className="mt-[var(--fin-s-1)] flex flex-col gap-1">
            {anteriores.map(c => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-[var(--fin-s-2)]">
                <StatusChip valor={c.status} dominio="cobranca" />
                <span className="tabular-nums">{ROTULO_DO_TIPO[c.tipo]} · vencia {dataBR(c.vencimento)}</span>
                {c.erro ? <span className="text-[var(--fin-text-2)]">· {mensagemDeErro(null, c.erro)}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {recebida ? (
        <div>
          <Link
            href={`/recibo/${encodeURIComponent(conta.id)}`}
            target="_blank"
            className="inline-flex h-11 items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 fin-t-body text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:h-9"
          >
            <Printer aria-hidden="true" className="size-4" /> Imprimir recibo
          </Link>
        </div>
      ) : null}

      {conta.cliente_id ? <PortalDoCliente clienteId={conta.cliente_id} podeEditar={podeEmitir} /> : null}

      {dialogos}
      <EmitirCobrancas contas={emitir} onFechar={() => setEmitir(null)} onConcluido={recarregar} />
      <ResolverPendencia cobrancaId={pendencia} onFechar={() => setPendencia(null)} onResolvida={recarregar} />
      <ConfirmDialog
        aberto={link.aberto}
        onOpenChange={a => { if (!a) setLink({ aberto: false, gravando: false, erro: null }); }}
        titulo="Gerar link de pagamento?"
        oQueVaiAcontecer="O provedor cria uma página com o valor desta conta, onde o cliente escolhe como pagar: Pix, boleto ou cartão de crédito (à vista). O link é copiado para você mandar e vale pelos dias escolhidos em Configurações › Cobrança; quando ele pagar, a conta é baixada sozinha."
        detalhes={[
          { rotulo: 'Cliente', valor: conta.cliente_nome || 'Cliente' },
          { rotulo: 'Valor', valor: <Money valor={saldo} size="body" align="esquerda" estado="ok" /> },
        ]}
        previa={link.erro ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">{link.erro}</p> : undefined}
        confirmarRotulo="Gerar e copiar o link"
        processando={link.gravando}
        onConfirmar={() => { void gerarLink(); }}
      />
    </section>
  );
}
