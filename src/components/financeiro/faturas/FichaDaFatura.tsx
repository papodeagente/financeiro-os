'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Check, ChevronLeft, Copy, ExternalLink, FileText, MessageSquareWarning, Pencil, Receipt, Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { StatusChip } from '@/components/fin/StatusChip';
import { CampoReais } from '@/components/vendas/ficha/comum';
import {
  CAMPOS_DA_FATURA, INFO_DO_MODELO, MODELOS_DE_FATURA, NOMES_DAS_RETENCOES,
  type CampoDaFatura, type ConfigRetencoes, type ModeloDeFatura,
} from '@/lib/fatura-regras';
import type { AjusteDaFatura, ItemDaFatura } from '@/lib/fatura-servidor';
import { valorDaColuna } from '@/lib/fatura-documento';
import { deCentavos } from '@/lib/money';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { apiFaturas, ErroDaFatura, novaChave, type FichaDaFatura as Ficha } from './api';
import { dataBR, fraseDoEvento, periodoBR, quandoBR, reais } from './comum';
import { ConferenciaPorArquivo } from './ConferenciaPorArquivo';
import { Aviso, BOTAO_LINHA, CONTROLE, LINK, SECAO, TituloDaSecao } from './pecas';
import { ROTULO_COBRANCA_CURTO } from './rotulos';

/**
 * Ficha da fatura do cliente (E5, parte B). Mesmo jeito das outras fichas:
 * cabeçalho com a situação, as ações que valem agora e o histórico. A fatura
 * aberta recebe e solta itens; a fechada não muda — o que precisar mudar vira
 * nota de crédito ou débito escrita, nunca diferença escondida.
 */

type Dialogo =
  | { tipo: 'fechar' }
  | { tipo: 'cobrar'; chave: string }
  | { tipo: 'reabrir' }
  | { tipo: 'saldo' }
  | { tipo: 'mover' }
  | { tipo: 'avulso' }
  | { tipo: 'tirar' }
  | { tipo: 'corrigir'; item: ItemDaFatura }
  | { tipo: 'responder'; item: ItemDaFatura }
  | { tipo: 'nota' }
  | { tipo: 'remover_nota'; nota: AjusteDaFatura }
  | { tipo: 'imprimir' }
  | { tipo: 'retencoes' };

const MOTIVO_MINIMO = 10;

export function FichaDaFatura({ faturaId }: { faturaId: string }) {
  const [ficha, setFicha] = React.useState<Ficha | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [dialogo, setDialogo] = React.useState<Dialogo | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set());
  const [vezDoDialogo, setVezDoDialogo] = React.useState(0);
  /** Cada diálogo aberto começa com os campos limpos (remonta pela chave). */
  const abrir = (d: Dialogo) => { setVezDoDialogo(n => n + 1); setDialogo(d); };
  const [cobrancaNova, setCobrancaNova] = React.useState<{ linha: string | null; pix: string | null; url: string | null } | null>(null);

  const carregar = React.useCallback(async () => {
    try {
      const f = await apiFaturas.ficha(faturaId);
      setFicha(f);
      setErro(null);
      setAtualizadoEm(new Date());
      document.title = `Fatura Nº ${f.fatura.numero}`;
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir a fatura.');
    }
  }, [faturaId]);

  // A página monta este componente com key={id}: trocar de fatura começa do zero.
  React.useEffect(() => {
    const ac = new AbortController();
    apiFaturas.ficha(faturaId, ac.signal)
      .then(f => { setFicha(f); setErro(null); setAtualizadoEm(new Date()); document.title = `Fatura Nº ${f.fatura.numero}`; })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : 'Não foi possível abrir a fatura.'); });
    return () => ac.abort();
  }, [faturaId]);

  /** Roda uma ação que devolve a ficha nova; fecha o diálogo e avisa. */
  async function executar(fn: () => Promise<Ficha | { ficha: Ficha }>, sucesso: string, detalhe?: string): Promise<boolean> {
    setOcupado(true);
    try {
      const r = await fn();
      setFicha('ficha' in r && !('fatura' in r) ? r.ficha : r as Ficha);
      setAtualizadoEm(new Date());
      setDialogo(null);
      setMarcados(new Set());
      toast.success(sucesso, detalhe);
      return true;
    } catch (e) {
      toast.error('Não deu certo', e instanceof ErroDaFatura || e instanceof Error ? e.message : undefined);
      // Parte pode ter acontecido (ex.: fechou e o provedor recusou o boleto): mostra o estado real.
      void carregar();
      return false;
    } finally {
      setOcupado(false);
    }
  }

  const f = ficha?.fatura;
  const perm = ficha?.permissoes;
  const aberta = f?.situacao === 'ABERTA';
  const fechada = f?.situacao === 'FECHADA';
  const editavel = Boolean(ficha?.editavel && perm?.editar);
  const cobrancaValendo = Boolean(ficha?.cobranca && ['emitindo', 'aberta', 'vencida'].includes(ficha.cobranca.status));
  const paga = ficha?.situacao_visivel === 'PAGA';
  const parcial = ficha?.situacao_visivel === 'PARCIAL';
  const podeCobrar = Boolean(perm?.cobrar && perm?.fechar && !cobrancaValendo && !paga && !parcial && f && f.situacao !== 'CANCELADA' && ficha?.itens.length);

  const acaoPrimaria = !ficha || !f ? undefined
    : podeCobrar && (aberta || fechada)
      ? { rotulo: aberta ? 'Fechar e cobrar' : 'Cobrar com boleto e Pix', icone: Receipt, onClick: () => abrir({ tipo: 'cobrar', chave: novaChave(`fatura-${f.id}`) }) }
      : aberta && perm?.fechar ? { rotulo: 'Fechar fatura', onClick: () => abrir({ tipo: 'fechar' }) }
        : undefined;

  const secundarias: { rotulo: string; href?: string; onClick?: () => void }[] = [];
  if (ficha && f) {
    if (aberta && perm?.fechar && podeCobrar) secundarias.push({ rotulo: 'Só fechar', onClick: () => abrir({ tipo: 'fechar' }) });
    if (fechada && perm?.reabrir && !paga && !parcial) secundarias.push({ rotulo: 'Reabrir', onClick: () => abrir({ tipo: 'reabrir' }) });
    if (parcial && perm?.editar) secundarias.push({ rotulo: 'Levar saldo para a próxima', onClick: () => abrir({ tipo: 'saldo' }) });
    secundarias.push({ rotulo: 'Imprimir', onClick: () => abrir({ tipo: 'imprimir' }) });
    // Recibo consolidado (E7): cada recebimento da fatura e o total; parcial diz quanto falta.
    if (paga || parcial) secundarias.push({ rotulo: parcial ? 'Recibo do que já foi pago' : 'Recibo', href: `/financeiro-ag/faturas/${encodeURIComponent(f.id)}/recibo` });
    if (perm?.exportar) {
      secundarias.push({ rotulo: 'Exportar CSV', href: apiFaturas.urlExportar(f.id, 'csv') });
      secundarias.push({ rotulo: 'Exportar Excel', href: apiFaturas.urlExportar(f.id, 'xlsx') });
    }
  }

  const escolhidos = ficha?.itens.filter(i => marcados.has(i.conta_id)) ?? [];
  const somaEscolhidos = escolhidos.reduce((a, i) => a + i.valor_centavos, 0);

  return (
    <MolduraDaPagina>
      <div className="flex flex-col gap-[var(--fin-s-5)]">
        <nav aria-label="Navegação entre faturas" className="flex flex-wrap items-center justify-between gap-[var(--fin-s-2)]">
          <Link href="/financeiro-ag/faturas" className={cn(BOTAO_LINHA, 'fin-t-body')}><ChevronLeft aria-hidden="true" className="size-4" /> Faturas</Link>
          {ficha ? (
            <span className="flex items-center gap-1">
              {ficha.anterior
                ? <Link href={`/financeiro-ag/faturas/${encodeURIComponent(ficha.anterior.id)}`} className={cn(BOTAO_LINHA, 'fin-t-body')}><ArrowLeft aria-hidden="true" className="size-4" /> Fatura anterior <span className="tabular-nums text-[var(--fin-text-3)]">Nº {ficha.anterior.numero}</span></Link>
                : <span className="px-2 fin-t-caption text-[var(--fin-text-3)]">Primeira fatura deste cliente</span>}
              {ficha.proxima
                ? <Link href={`/financeiro-ag/faturas/${encodeURIComponent(ficha.proxima.id)}`} className={cn(BOTAO_LINHA, 'fin-t-body')}>Próxima fatura <span className="tabular-nums text-[var(--fin-text-3)]">Nº {ficha.proxima.numero}</span> <ArrowRight aria-hidden="true" className="size-4" /></Link>
                : <span className="px-2 fin-t-caption text-[var(--fin-text-3)]">Última fatura deste cliente</span>}
            </span>
          ) : null}
        </nav>

        <PageHeader
          icone={FileText}
          titulo={f ? `Fatura Nº ${f.numero}` : 'Fatura'}
          subtitulo={f ? `${f.pessoa_nome || 'Cliente'} · ${periodoBR(f.periodo_inicio, f.periodo_fim)} · vence ${dataBR(f.vencimento)}${f.avulsa ? ' · avulsa' : ''}${f.complementar_de ? ' · complementar' : ''}` : undefined}
          badge={ficha ? (
            <span className="flex flex-wrap gap-1">
              <StatusChip dominio="fatura" valor={ficha.situacao_visivel} size="md" />
              {f && f.situacao !== 'ABERTA' ? <StatusChip dominio="conferencia_fatura" valor={f.conferencia} size="md" /> : null}
            </span>
          ) : undefined}
          acaoPrimaria={acaoPrimaria}
          acoesSecundarias={secundarias.length ? secundarias : undefined}
          atualizadoEm={atualizadoEm}
          onRecarregar={carregar}
        />

        <DataState
          estado={!ficha && !erro ? 'carregando' : !ficha && erro ? 'erro' : 'ok'}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
          esqueleto={<div className="flex flex-col gap-[var(--fin-s-3)]"><div className="h-24 rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" /><div className="h-72 rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" /></div>}
        >
          {ficha && f ? (
            <div className="flex flex-col gap-[var(--fin-s-4)]">
              <Faixas ficha={ficha} />

              <Totais ficha={ficha} podeAjustarRetencoes={editavel} onAjustarRetencoes={() => abrir({ tipo: 'retencoes' })} />

              {ficha.cobranca || cobrancaNova ? <BlocoDaCobranca ficha={ficha} nova={cobrancaNova} /> : null}

              <section className={SECAO} aria-labelledby="itens-da-fatura">
                <TituloDaSecao
                  id="itens-da-fatura"
                  titulo="Itens da fatura"
                  descricao={editavel
                    ? 'Marque os itens para mover para outro vencimento, faturar à parte ou tirar da fatura. Corrigir valor vira nota escrita.'
                    : aberta ? 'A fatura tem pagamento ou cobrança: os itens não mudam mais.' : 'Fatura fechada: os itens não mudam. Para corrigir um valor, a diferença vai como nota para a próxima fatura do cliente.'}
                />
                {editavel && marcados.size ? (
                  <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] sm:flex-row sm:items-center sm:justify-between">
                    <p className="fin-t-body text-[var(--fin-text-2)]" aria-live="polite">{escolhidos.length} {escolhidos.length === 1 ? 'item' : 'itens'}, {reais(somaEscolhidos)}</p>
                    <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                      <Button type="button" variant="outline" onClick={() => abrir({ tipo: 'mover' })}>Mover itens</Button>
                      <Button type="button" variant="outline" onClick={() => abrir({ tipo: 'avulso' })}>Faturar avulso</Button>
                      <Button type="button" variant="ghost" onClick={() => abrir({ tipo: 'tirar' })}>Tirar da fatura</Button>
                    </div>
                  </div>
                ) : null}
                <TabelaDeItens
                  ficha={ficha}
                  editavel={editavel}
                  podeEditar={Boolean(perm?.editar)}
                  marcados={marcados}
                  onMarcar={setMarcados}
                  onCorrigir={item => abrir({ tipo: 'corrigir', item })}
                  onResponder={item => abrir({ tipo: 'responder', item })}
                  onConferido={(item, valor) => { void executar(() => apiFaturas.itens(f.id, { acao: 'conferido', conta_id: item.conta_id, conferido: valor }), valor ? 'Item marcado como conferido' : 'Conferência desfeita'); }}
                />
              </section>

              <BlocoDeNotas
                ficha={ficha}
                podeLancar={Boolean(perm?.editar) && f.situacao !== 'CANCELADA'}
                onLancar={() => abrir({ tipo: 'nota' })}
                onRemover={nota => abrir({ tipo: 'remover_nota', nota })}
              />

              <ConferenciaPorArquivo
                itens={ficha.itens}
                desabilitado={!perm?.editar || paga || f.situacao === 'CANCELADA' || !ficha.itens.length}
                motivoDesabilitado={paga ? 'Fatura paga não se confere mais.' : !ficha.itens.length ? 'A fatura não tem itens.' : undefined}
                onConferir={async (linhas, arquivo) => {
                  try {
                    const r = await apiFaturas.conferir(f.id, linhas, arquivo);
                    setFicha(r.ficha);
                    return r.relatorio;
                  } catch (e) {
                    toast.error('A conferência não rodou', e instanceof Error ? e.message : undefined);
                    return null;
                  }
                }}
              />

              <section className={SECAO} aria-labelledby="historico-da-fatura">
                <TituloDaSecao id="historico-da-fatura" titulo="Histórico" descricao="Tudo o que aconteceu com esta fatura, com quem e quando. Não se apaga." />
                {ficha.eventos.length ? (
                  <ol className="flex flex-col divide-y divide-[var(--fin-border)]">
                    {ficha.eventos.map(e => (
                      <li key={e.id} className="flex flex-col gap-0.5 py-[var(--fin-s-2)] sm:flex-row sm:items-baseline sm:gap-[var(--fin-s-3)]">
                        <span className="shrink-0 tabular-nums fin-t-caption text-[var(--fin-text-3)] sm:w-36">{quandoBR(e.criado_em)}</span>
                        <span className="min-w-0 fin-t-body text-[var(--fin-text)]">
                          {fraseDoEvento(e)}
                          {e.motivo && !['juntada'].includes(e.tipo) ? <span className="block fin-t-caption text-[var(--fin-text-2)]">“{e.motivo}”</span> : null}
                        </span>
                        <span className="shrink-0 fin-t-caption text-[var(--fin-text-3)] sm:ml-auto">{e.usuario_nome || 'Sistema'}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="fin-t-body text-[var(--fin-text-3)]">Nada registrado ainda.</p>}
              </section>
            </div>
          ) : null}
        </DataState>
      </div>

      {ficha && f ? (
        <Dialogos
          key={vezDoDialogo}
          ficha={ficha}
          dialogo={dialogo}
          ocupado={ocupado}
          escolhidos={escolhidos}
          onFechar={() => setDialogo(null)}
          executar={executar}
          onCobrada={c => setCobrancaNova(c)}
        />
      ) : null}
    </MolduraDaPagina>
  );
}

// ---------------------------------------------------------------------------
// Faixas de aviso do topo

function Faixas({ ficha }: { ficha: Ficha }) {
  const f = ficha.fatura;
  const contestados = ficha.itens.filter(i => i.contestacao && !i.resposta).length;
  return (
    <>
      {f.vencimento_ajuste ? <Aviso tom="neutro">Vencimento em {dataBR(f.vencimento)}. {f.vencimento_ajuste}</Aviso> : null}
      {f.situacao === 'FECHADA' ? (
        <Aviso tom="neutro">
          Fechada {f.fechada_em ? `em ${quandoBR(f.fechada_em)}` : ''}{f.fechada_por ? ` por ${f.fechada_por}` : ''}.
          {f.conferencia === 'AGUARDANDO' ? <> O cliente já pode conferir e aprovar no portal. O link pessoal dele fica na{' '}
            <Link href={`/financeiro-ag/receber?abrir=${encodeURIComponent(f.titulo_id)}`} className={LINK}>conta a receber da fatura</Link>, no bloco Cobrança.</> : ''}
          {f.conferencia === 'APROVADA' ? ` O cliente aprovou ${f.conferida_em ? `em ${quandoBR(f.conferida_em)}` : ''}.` : ''}
        </Aviso>
      ) : null}
      {f.conferencia === 'CONTESTADA' && contestados ? (
        <Aviso tom="negativo">
          O cliente contestou {contestados === 1 ? 'um item' : `${contestados} itens`}. Veja o motivo na linha do item e responda; se o valor estiver errado, use Corrigir valor (vira nota de crédito ou débito).
        </Aviso>
      ) : null}
      {f.invalida ? <Aviso tom="negativo">As notas de crédito passam do valor dos itens: a fatura ficaria negativa e não fecha assim. Tire uma nota ou inclua itens.</Aviso> : null}
      {f.situacao === 'CANCELADA' ? <Aviso tom="neutro">Esta fatura foi cancelada. Ela fica guardada com o histórico.</Aviso> : null}
      {ficha.situacao_visivel === 'PARCIAL' && ficha.titulo ? (
        <Aviso tom="aviso">
          Entraram {reais(Math.round(ficha.titulo.valor_recebido * 100))} de {reais(Math.round(ficha.titulo.valor_final * 100))}. O que falta pode ficar em aberto nesta fatura ou ir para a próxima como nota de débito explicada (“Levar saldo para a próxima”).
        </Aviso>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Totais

function Totais({ ficha, podeAjustarRetencoes, onAjustarRetencoes }: { ficha: Ficha; podeAjustarRetencoes: boolean; onAjustarRetencoes: () => void }) {
  const t = ficha.totais;
  const recebido = ficha.titulo ? Math.round(ficha.titulo.valor_recebido * 100) : 0;
  return (
    <section aria-label="Totais da fatura" className={cn(SECAO, 'gap-[var(--fin-s-3)]')}>
      <dl className="grid grid-cols-2 gap-[var(--fin-s-4)] sm:grid-cols-3 lg:grid-cols-6">
        <Numero rotulo="Itens" valor={reais(t.itens)} dica={`${ficha.itens.length} ${ficha.itens.length === 1 ? 'item' : 'itens'}`} />
        <Numero rotulo="Notas de crédito" valor={t.creditos ? `− ${reais(t.creditos)}` : reais(0)} tom={t.creditos ? 'positivo' : 'neutro'} />
        <Numero rotulo="Notas de débito" valor={reais(t.debitos)} />
        <Numero rotulo="Retenções na fonte" valor={t.total_retencoes ? `− ${reais(t.total_retencoes)}` : reais(0)} dica={t.retencoes.length ? t.retencoes.map(r => `${r.nome} ${String(r.percentual).replace('.', ',')}%`).join(' · ') : 'Nenhuma'} />
        <Numero rotulo="Total a pagar" valor={reais(t.liquido)} destaque tom={t.invalida ? 'negativo' : 'neutro'} />
        <Numero rotulo="Recebido" valor={reais(recebido)} tom={recebido ? 'positivo' : 'neutro'} dica={ficha.titulo?.data_recebimento ? `em ${dataBR(ficha.titulo.data_recebimento)}` : undefined} />
      </dl>
      {podeAjustarRetencoes ? (
        <div>
          <button type="button" className={cn(LINK, 'fin-t-caption')} onClick={onAjustarRetencoes}>Ajustar as retenções desta fatura</button>
        </div>
      ) : null}
    </section>
  );
}

function Numero({ rotulo, valor, dica, destaque, tom = 'neutro' }: { rotulo: string; valor: string; dica?: string; destaque?: boolean; tom?: 'neutro' | 'positivo' | 'negativo' }) {
  const cor = tom === 'positivo' ? 'text-[var(--fin-positive)]' : tom === 'negativo' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]';
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="fin-t-caption text-[var(--fin-text-2)]">{rotulo}</dt>
      <dd className={cn('tabular-nums', destaque ? 'fin-t-metric-sm' : 'fin-t-body-strong', cor)}>{valor}</dd>
      {dica ? <dd className="truncate fin-t-caption text-[var(--fin-text-3)]" title={dica}>{dica}</dd> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cobrança

function BlocoDaCobranca({ ficha, nova }: { ficha: Ficha; nova: { linha: string | null; pix: string | null; url: string | null } | null }) {
  const c = ficha.cobranca;
  const linha = c?.linha_digitavel || nova?.linha || '';
  const pix = c?.pix_copia_cola || nova?.pix || '';
  const url = c?.url_boleto || nova?.url || '';
  async function copiar(texto: string, oque: string) {
    try { await navigator.clipboard.writeText(texto); toast.success(`${oque} copiado`); } catch { toast.error('Não consegui copiar', 'Selecione o texto e copie à mão.'); }
  }
  return (
    <section className={SECAO} aria-labelledby="cobranca-da-fatura">
      <TituloDaSecao
        id="cobranca-da-fatura"
        titulo="Cobrança"
        descricao={c ? `${ROTULO_COBRANCA_CURTO[c.status] ?? c.status}${c.vencimento ? ` · vence ${dataBR(c.vencimento)}` : ''}. Quando o cliente paga, a fatura é baixada sozinha.` : 'Boleto e Pix emitidos.'}
        acao={c ? <Link href={`/financeiro-ag/cobrancas`} className={cn(BOTAO_LINHA, 'fin-t-body')}>Ver em Cobranças</Link> : null}
      />
      <div className="flex flex-wrap gap-[var(--fin-s-2)]">
        {linha ? <Button type="button" variant="outline" className="gap-[var(--fin-s-2)]" onClick={() => { void copiar(linha, 'Linha digitável'); }}><Copy aria-hidden="true" className="size-4" /> Copiar linha digitável</Button> : null}
        {pix ? <Button type="button" variant="outline" className="gap-[var(--fin-s-2)]" onClick={() => { void copiar(pix, 'Pix copia e cola'); }}><Copy aria-hidden="true" className="size-4" /> Copiar Pix</Button> : null}
        {url ? <a href={url} target="_blank" rel="noreferrer" className={cn(BOTAO_LINHA, 'fin-t-body')}><ExternalLink aria-hidden="true" className="size-4" /> Abrir o boleto</a> : null}
      </div>
      {linha ? <p className="break-all tabular-nums fin-t-caption text-[var(--fin-text-2)]">{linha}</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Itens

function TabelaDeItens({ ficha, editavel, podeEditar, marcados, onMarcar, onCorrigir, onResponder, onConferido }: {
  ficha: Ficha;
  editavel: boolean;
  podeEditar: boolean;
  marcados: Set<string>;
  onMarcar: React.Dispatch<React.SetStateAction<Set<string>>>;
  onCorrigir: (i: ItemDaFatura) => void;
  onResponder: (i: ItemDaFatura) => void;
  onConferido: (i: ItemDaFatura, valor: boolean) => void;
}) {
  const aberta = ficha.fatura.situacao !== 'CANCELADA';
  const colunas: FinColuna<ItemDaFatura>[] = [
    {
      id: 'item', cabecalho: 'Item', tipo: 'texto', minWidth: 260, acessor: i => i.descricao.toLowerCase(),
      render: i => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="max-w-[56ch] truncate fin-t-body-strong text-[var(--fin-text)]" title={i.descricao}>{valorDaColuna(i, 'produto') || i.descricao}</span>
          <span className="fin-t-caption text-[var(--fin-text-2)]">
            {[i.venda_numero ? `Venda ${i.venda_numero}` : '', valorDaColuna(i, 'passageiros'), valorDaColuna(i, 'localizador') ? `Loc. ${valorDaColuna(i, 'localizador')}` : '', i.detalhes.centro_custo ? `Centro de custo ${i.detalhes.centro_custo}` : '']
              .filter(Boolean).join(' · ')}
          </span>
          {i.contestacao ? (
            <span className="mt-1 flex items-start gap-1 fin-t-caption text-[var(--fin-negative-text)]">
              <MessageSquareWarning aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>Cliente: “{i.contestacao}”{i.resposta ? <span className="block text-[var(--fin-text-2)]">Resposta: “{i.resposta}”</span> : null}</span>
            </span>
          ) : null}
        </span>
      ),
    },
    { id: 'data_venda', cabecalho: 'Venda em', tipo: 'data', sortable: true, prioridade: 2, valor: i => i.data_venda },
    {
      id: 'viagem', cabecalho: 'Viagem', tipo: 'texto', prioridade: 1, minWidth: 150,
      render: i => <span className="tabular-nums text-[var(--fin-text-2)]">{valorDaColuna(i, 'viagem') || '—'}</span>,
    },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', sortable: true, valor: i => deCentavos(i.valor_centavos) },
    {
      id: 'conferido', cabecalho: 'Conferido', tipo: 'texto', prioridade: 2, minWidth: 120,
      render: i => (
        <span className="flex flex-col">
          <span className={cn('inline-flex items-center gap-1 fin-t-caption', i.conferido ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text-3)]')}>
            {i.conferido ? <><Check aria-hidden="true" className="size-3.5" /> Conferido</> : 'Não conferido'}
          </span>
          {i.conferencia_nota && !i.conferido ? <span className="max-w-[28ch] fin-t-caption text-[var(--fin-warning-text)]">{i.conferencia_nota}</span> : null}
        </span>
      ),
    },
    {
      id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: i => (podeEditar && aberta ? (
        <span className="inline-flex items-center justify-end gap-1">
          {i.contestacao && !i.resposta ? <button type="button" className={BOTAO_LINHA} onClick={() => onResponder(i)}>Responder</button> : null}
          <button type="button" className={BOTAO_LINHA} onClick={() => onConferido(i, !i.conferido)} aria-label={i.conferido ? `Desfazer conferência de ${i.descricao}` : `Marcar ${i.descricao} como conferido`}>
            <Check aria-hidden="true" className="size-3.5" /> {i.conferido ? 'Desfazer' : 'Conferi'}
          </button>
          <button type="button" className={BOTAO_LINHA} onClick={() => onCorrigir(i)} aria-label={`Corrigir o valor de ${i.descricao}`}>
            <Pencil aria-hidden="true" className="size-3.5" /> Corrigir valor
          </button>
        </span>
      ) : null),
    },
  ];
  return (
    <FinTable<ItemDaFatura>
      linhas={ficha.itens}
      colunas={colunas}
      chave={i => i.conta_id}
      densidade="compacta"
      estado="ok"
      selecao={editavel ? {
        selecionadas: marcados,
        onAlterar: (chaves, marcar) => onMarcar(atual => { const n = new Set(atual); for (const c of chaves) { if (marcar) n.add(c); else n.delete(c); } return n; }),
        rotulo: i => `Escolher ${i.descricao}`,
      } : undefined}
      vazio={{ motivo: 'sem-dado', titulo: 'Sem itens', oQueE: 'Esta fatura não tem itens. Ela pode ter só notas de crédito ou débito.' }}
      totais={ficha.itens.length ? [{ colunaId: 'valor', valor: deCentavos(ficha.totais.itens), rotulo: 'Total dos itens' }] : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Notas de crédito e débito

function BlocoDeNotas({ ficha, podeLancar, onLancar, onRemover }: { ficha: Ficha; podeLancar: boolean; onLancar: () => void; onRemover: (n: AjusteDaFatura) => void }) {
  const editavel = ficha.editavel;
  return (
    <section className={SECAO} aria-labelledby="notas-da-fatura">
      <TituloDaSecao
        id="notas-da-fatura"
        titulo="Notas de crédito e débito"
        descricao="Cada ajuste fica escrito, com o motivo, para o cliente ler na fatura. Nada passa de uma fatura para outra sem nota."
        acao={podeLancar ? <Button type="button" variant="outline" onClick={onLancar}>Lançar nota</Button> : null}
      />
      {ficha.notas.length ? (
        <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
          {ficha.notas.map(n => (
            <li key={n.id} className="flex flex-col gap-[var(--fin-s-1)] py-[var(--fin-s-2)] sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="fin-t-body-strong text-[var(--fin-text)]">{n.tipo === 'CREDITO' ? 'Nota de crédito' : 'Nota de débito'}</span>
                <span className="fin-t-body text-[var(--fin-text-2)]">{n.motivo}</span>
                <span className="fin-t-caption text-[var(--fin-text-3)]">{n.criado_por_nome || 'Sistema'} · {quandoBR(n.criado_em)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-[var(--fin-s-2)]">
                <span className={cn('tabular-nums fin-t-body-strong', n.tipo === 'CREDITO' ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text)]')}>
                  {n.tipo === 'CREDITO' ? '− ' : '+ '}{reais(n.valor_centavos)}
                </span>
                {editavel && podeLancar ? (
                  <button type="button" className={BOTAO_LINHA} onClick={() => onRemover(n)} aria-label={`Remover a nota: ${n.motivo}`}>
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="fin-t-body text-[var(--fin-text-3)]">Nenhuma nota nesta fatura.</p>}

      {ficha.notas_esperando.length ? (
        <div className="flex flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] pt-[var(--fin-s-3)]">
          <h3 className="fin-t-body-strong text-[var(--fin-text)]">Esperando a próxima fatura deste cliente</h3>
          <ul className="flex flex-col gap-1">
            {ficha.notas_esperando.map(n => (
              <li key={n.id} className="flex flex-col gap-0.5 fin-t-caption text-[var(--fin-text-2)] sm:flex-row sm:justify-between">
                <span>{n.tipo === 'CREDITO' ? 'Crédito' : 'Débito'} · {n.motivo}</span>
                <span className="shrink-0 tabular-nums">{n.tipo === 'CREDITO' ? '− ' : '+ '}{reais(n.valor_centavos)}</span>
              </li>
            ))}
          </ul>
          <p className="fin-t-caption text-[var(--fin-text-3)]">Entram sozinhas na próxima fatura aberta do cliente. Para faturar já, use a aba Itens a faturar da lista de faturas.</p>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Diálogos

function Dialogos({ ficha, dialogo, ocupado, escolhidos, onFechar, executar, onCobrada }: {
  ficha: Ficha;
  dialogo: Dialogo | null;
  ocupado: boolean;
  escolhidos: ItemDaFatura[];
  onFechar: () => void;
  executar: (fn: () => Promise<Ficha | { ficha: Ficha }>, sucesso: string, detalhe?: string) => Promise<boolean>;
  onCobrada: (c: { linha: string | null; pix: string | null; url: string | null }) => void;
}) {
  const f = ficha.fatura;
  const [motivo, setMotivo] = React.useState('');
  const [data, setData] = React.useState(dialogo?.tipo === 'mover' ? '' : f.vencimento);
  const [valor, setValor] = React.useState(dialogo?.tipo === 'corrigir' ? dialogo.item.valor_centavos : 0);
  const [tipoNota, setTipoNota] = React.useState<'CREDITO' | 'DEBITO'>('CREDITO');
  const [proxima, setProxima] = React.useState(false);
  const [modelo, setModelo] = React.useState<ModeloDeFatura>(f.modelo);
  const [campos, setCampos] = React.useState<CampoDaFatura[]>(f.campos.length ? f.campos : ['venda', 'produto', 'passageiros', 'centro_custo', 'valor']);
  const [ret, setRet] = React.useState<ConfigRetencoes>(f.retencoes);
  const [toque, setToque] = React.useState(false);

  const soma = escolhidos.reduce((a, i) => a + i.valor_centavos, 0);
  const qtd = `${escolhidos.length} ${escolhidos.length === 1 ? 'item' : 'itens'} (${reais(soma)})`;
  const aberto = (t: Dialogo['tipo']) => dialogo?.tipo === t;
  const fechar = (a: boolean) => { if (!a) onFechar(); };
  const ids = escolhidos.map(i => i.conta_id);

  const motivoErro = toque && motivo.trim().length < 5 ? 'Escreva o motivo em poucas palavras.' : null;

  return (
    <>
      <ConfirmDialog
        aberto={aberto('fechar')} onOpenChange={fechar} titulo={`Fechar a fatura Nº ${f.numero}`}
        oQueVaiAcontecer="A fatura deixa de receber e soltar itens, ganha a data de emissão de hoje e fica disponível para o cliente conferir e aprovar no portal. Para mudar depois, alguém com o direito reabre com o motivo, ou lança uma nota para a próxima fatura."
        detalhes={[{ rotulo: 'Cliente', valor: f.pessoa_nome }, { rotulo: 'Vencimento', valor: dataBR(f.vencimento) }, { rotulo: 'Total a pagar', valor: reais(ficha.totais.liquido) }]}
        confirmarRotulo="Fechar fatura" processando={ocupado}
        onConfirmar={() => { void executar(() => apiFaturas.fechar(f.id), `Fatura Nº ${f.numero} fechada`, 'O cliente já pode conferir no portal.'); }}
      />

      <ConfirmDialog
        aberto={aberto('cobrar')} onOpenChange={fechar}
        titulo={f.situacao === 'ABERTA' ? `Fechar e cobrar a fatura Nº ${f.numero}` : `Cobrar a fatura Nº ${f.numero}`}
        oQueVaiAcontecer={`${f.situacao === 'ABERTA' ? 'A fatura é fechada e ' : ''}o boleto com Pix sai agora pelo provedor da agência (Asaas ou Pagar.me), no valor total a pagar e com o vencimento da fatura. Quando o cliente paga, a fatura é baixada sozinha.`}
        detalhes={[{ rotulo: 'Cliente', valor: f.pessoa_nome }, { rotulo: 'Vencimento', valor: dataBR(f.vencimento) }, { rotulo: 'Valor', valor: reais(ficha.totais.liquido) }]}
        confirmarRotulo={f.situacao === 'ABERTA' ? 'Fechar e cobrar' : 'Emitir boleto e Pix'} processando={ocupado}
        onConfirmar={() => {
          if (dialogo?.tipo !== 'cobrar') return;
          const chave = dialogo.chave;
          void executar(async () => {
            const r = await apiFaturas.cobrar(f.id, chave);
            if (r.cobranca) onCobrada({ linha: r.cobranca.linha_digitavel, pix: r.cobranca.pix_copia_cola, url: r.cobranca.url_boleto });
            if (r.cobranca?.status === 'falhou') throw new ErroDaFatura(r.cobranca.erro || 'O provedor recusou a cobrança.', 422, 'FALHOU');
            return r;
          }, 'Cobrança emitida', 'O boleto e o Pix estão no bloco Cobrança desta fatura.');
        }}
      />

      <RecordSheet
        aberto={aberto('reabrir')} onOpenChange={fechar} titulo={`Reabrir a fatura Nº ${f.numero}`}
        descricao="A fatura volta a receber e soltar itens. Se o cliente já recebeu para conferir, ele vai ver a nova versão quando você fechar de novo."
        resumo={f.conferencia !== 'NAO_ENVIADA' ? 'O cliente já tinha esta fatura para conferir. Se preferir não mexer nela, lance uma nota para a próxima.' : undefined}
        acaoPrimaria={{ rotulo: 'Reabrir fatura', carregando: ocupado, desabilitado: motivo.trim().length < MOTIVO_MINIMO, onClick: () => { void executar(() => apiFaturas.reabrir(f.id, motivo.trim()), `Fatura Nº ${f.numero} reaberta`); } }}
        largura={480}
      >
        <Field rotulo="Por que reabrir" obrigatorio ajuda="Fica no histórico da fatura." erro={motivo && motivo.trim().length < MOTIVO_MINIMO ? `Escreva ao menos ${MOTIVO_MINIMO} letras.` : null}>
          {a => <Textarea {...a} value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} placeholder="Ex.: o cliente pediu para incluir a viagem de 28/11" />}
        </Field>
      </RecordSheet>

      <ConfirmDialog
        aberto={aberto('saldo')} onOpenChange={fechar} titulo="Levar o saldo para a próxima fatura"
        oQueVaiAcontecer="Esta fatura fica recebida pelo que entrou. O que falta vira uma nota de débito na próxima fatura do cliente, escrita com o número desta fatura e o que foi pago, para ele entender a cobrança."
        detalhes={ficha.titulo ? [{ rotulo: 'Pago', valor: reais(Math.round(ficha.titulo.valor_recebido * 100)) }, { rotulo: 'Vai para a próxima', valor: reais(Math.round((ficha.titulo.valor_final - ficha.titulo.valor_recebido) * 100)) }] : undefined}
        confirmarRotulo="Levar o saldo" processando={ocupado}
        onConfirmar={() => { void executar(() => apiFaturas.levarSaldo(f.id), 'Saldo levado para a próxima fatura'); }}
      />

      <RecordSheet
        aberto={aberto('mover')} onOpenChange={fechar} titulo="Mover itens selecionados"
        descricao="Os itens vão para a fatura aberta deste cliente com o vencimento escolhido. Se ainda não houver uma, ela é criada."
        resumo={`${qtd} saem da fatura Nº ${f.numero}${data ? ` e vão para a fatura que vence em ${dataBR(data)}` : ''}.`}
        acaoPrimaria={{ rotulo: 'Mover itens', carregando: ocupado, desabilitado: !data || data === f.vencimento, onClick: () => { void executar(() => apiFaturas.itens(f.id, { acao: 'mover', conta_ids: ids, vencimento: data }), 'Itens movidos'); } }}
        largura={480}
      >
        <Field rotulo="Vencimento de destino" obrigatorio erro={data && data === f.vencimento ? 'É o vencimento desta mesma fatura: escolha outro.' : null}>
          {a => <Input type="date" {...a} value={data} onChange={e => setData(e.target.value)} />}
        </Field>
      </RecordSheet>

      <RecordSheet
        aberto={aberto('avulso')} onOpenChange={fechar} titulo="Faturar avulso"
        descricao="Os itens escolhidos saem desta fatura e viram uma fatura só deles, aberta, para você fechar e cobrar à parte."
        resumo={`Faturar avulso ${qtd}, com vencimento em ${dataBR(data)}.`}
        acaoPrimaria={{ rotulo: 'Faturar avulso', carregando: ocupado, desabilitado: !data, onClick: () => { void executar(() => apiFaturas.itens(f.id, { acao: 'avulso', conta_ids: ids, vencimento: data }), 'Fatura avulsa criada', 'Ela aparece na lista de faturas, aberta.'); } }}
        largura={480}
      >
        <Field rotulo="Vencimento da fatura avulsa" obrigatorio>
          {a => <Input type="date" {...a} value={data} onChange={e => setData(e.target.value)} />}
        </Field>
      </RecordSheet>

      <ConfirmDialog
        aberto={aberto('tirar')} onOpenChange={fechar} titulo="Tirar da fatura"
        oQueVaiAcontecer="Os itens voltam a ser contas a receber soltas, com o vencimento da venda, e não entram sozinhos em outra fatura. Ficam na aba Itens a faturar para você decidir."
        detalhes={[{ rotulo: 'Itens', valor: qtd }]}
        confirmarRotulo="Tirar da fatura" tone="destrutivo" processando={ocupado}
        onConfirmar={() => { void executar(() => apiFaturas.itens(f.id, { acao: 'tirar', conta_ids: ids }), 'Itens retirados da fatura'); }}
      />

      {dialogo?.tipo === 'corrigir' ? (() => {
        const item = dialogo.item;
        const dif = valor - item.valor_centavos;
        const naPropria = ficha.editavel;
        return (
          <RecordSheet
            aberto onOpenChange={fechar} titulo="Corrigir valor do item"
            descricao={naPropria
              ? 'O item não é reescrito: a diferença vira uma nota de crédito ou débito nesta mesma fatura, com o motivo que você escrever.'
              : 'Esta fatura não muda mais: a diferença vira uma nota de crédito ou débito na próxima fatura do cliente, com o número desta e o motivo.'}
            resumo={dif === 0 ? 'Escolha o valor certo do item.' : `${dif > 0 ? 'Nota de débito' : 'Nota de crédito'} de ${reais(Math.abs(dif))} ${naPropria ? 'nesta fatura' : 'na próxima fatura'}.`}
            acaoPrimaria={{
              rotulo: 'Lançar a correção', carregando: ocupado, desabilitado: dif === 0 || motivo.trim().length < 5,
              onClick: () => { setToque(true); if (motivo.trim().length >= 5) void executar(() => apiFaturas.itens(f.id, { acao: 'corrigir', conta_id: item.conta_id, valor_centavos: valor, motivo: motivo.trim() }), 'Correção lançada'); },
            }}
            largura={480}
          >
            <p className="fin-t-body text-[var(--fin-text-2)]">{item.descricao} · hoje {reais(item.valor_centavos)}</p>
            <div className="flex flex-col gap-1">
              <label htmlFor="corrigir-valor" className="fin-t-caption font-medium text-[var(--fin-text-2)]">Valor certo</label>
              <CampoReais id="corrigir-valor" rotulo="Valor certo do item" centavos={valor} onChange={setValor} />
            </div>
            <Field rotulo="Motivo" obrigatorio ajuda="O cliente lê esta frase na fatura." erro={motivoErro}>
              {a => <Textarea {...a} value={motivo} onBlur={() => setToque(true)} onChange={e => setMotivo(e.target.value)} rows={3} placeholder="Ex.: tarifa reemitida pela companhia com valor menor" />}
            </Field>
          </RecordSheet>
        );
      })() : null}

      {dialogo?.tipo === 'responder' ? (
        <RecordSheet
          aberto onOpenChange={fechar} titulo="Responder ao cliente"
          descricao="A resposta aparece para o cliente no portal, ao lado do item. Quando todas as contestações tiverem resposta, a fatura volta para ele conferir."
          acaoPrimaria={{ rotulo: 'Enviar resposta', carregando: ocupado, desabilitado: motivo.trim().length < 5, onClick: () => { void executar(() => apiFaturas.itens(f.id, { acao: 'responder', conta_id: dialogo.item.conta_id, resposta: motivo.trim() }), 'Resposta registrada'); } }}
          largura={480}
        >
          <Aviso tom="negativo">Cliente: “{dialogo.item.contestacao}”</Aviso>
          <Field rotulo="Resposta" obrigatorio>
            {a => <Textarea {...a} value={motivo} onChange={e => setMotivo(e.target.value)} rows={4} placeholder="Ex.: corrigimos com uma nota de crédito de R$ 120,00 nesta fatura" />}
          </Field>
        </RecordSheet>
      ) : null}

      <RecordSheet
        aberto={aberto('nota')} onOpenChange={fechar} titulo="Lançar nota"
        descricao="Crédito abate do que o cliente paga; débito acrescenta. O motivo sai escrito na fatura."
        resumo={valor > 0 ? `${tipoNota === 'CREDITO' ? 'Nota de crédito' : 'Nota de débito'} de ${reais(valor)} ${ficha.editavel && !proxima ? 'nesta fatura' : 'na próxima fatura do cliente'}.` : undefined}
        acaoPrimaria={{
          rotulo: 'Lançar nota', carregando: ocupado, desabilitado: valor <= 0 || motivo.trim().length < 5,
          onClick: () => { void executar(() => apiFaturas.lancarNota(f.id, { tipo: tipoNota, valor_centavos: valor, motivo: motivo.trim(), proxima: !ficha.editavel || proxima }), 'Nota lançada'); },
        }}
        largura={480}
      >
        <Segmentado<'CREDITO' | 'DEBITO'> rotulo="Tipo de nota" valor={tipoNota} onChange={setTipoNota} cheio
          opcoes={[{ valor: 'CREDITO', rotulo: 'Nota de crédito' }, { valor: 'DEBITO', rotulo: 'Nota de débito' }]} />
        <div className="flex flex-col gap-1">
          <label htmlFor="nota-valor" className="fin-t-caption font-medium text-[var(--fin-text-2)]">Valor</label>
          <CampoReais id="nota-valor" rotulo="Valor da nota" centavos={valor} onChange={setValor} />
        </div>
        <Field rotulo="Motivo" obrigatorio ajuda="O cliente lê esta frase na fatura.">
          {a => <Textarea {...a} value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} placeholder="Ex.: desconto combinado na renovação do contrato" />}
        </Field>
        {ficha.editavel ? (
          <label className="flex items-start gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)]">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--fin-accent)]" checked={proxima} onChange={e => setProxima(e.target.checked)} />
            Lançar na próxima fatura do cliente, não nesta
          </label>
        ) : <p className="fin-t-caption text-[var(--fin-text-3)]">Esta fatura não muda mais: a nota vai para a próxima fatura do cliente.</p>}
      </RecordSheet>

      <ConfirmDialog
        aberto={aberto('remover_nota')} onOpenChange={fechar} titulo="Remover a nota"
        oQueVaiAcontecer="A nota sai desta fatura e o total volta a ser calculado sem ela. Fica registrado no histórico."
        detalhes={dialogo?.tipo === 'remover_nota' ? [{ rotulo: dialogo.nota.tipo === 'CREDITO' ? 'Crédito' : 'Débito', valor: reais(dialogo.nota.valor_centavos) }, { rotulo: 'Motivo', valor: dialogo.nota.motivo }] : undefined}
        confirmarRotulo="Remover nota" tone="destrutivo" processando={ocupado}
        onConfirmar={() => { if (dialogo?.tipo === 'remover_nota') void executar(() => apiFaturas.removerNota(f.id, dialogo.nota.id), 'Nota removida'); }}
      />

      <RecordSheet
        aberto={aberto('imprimir')} onOpenChange={fechar} titulo="Imprimir a fatura"
        descricao="Escolha o modelo. A página abre pronta para imprimir ou salvar em PDF."
        acaoPrimaria={{
          rotulo: 'Abrir para imprimir', carregando: ocupado, desabilitado: modelo === 'PERSONALIZADA' && !campos.some(c => c !== 'valor'),
          onClick: async () => {
            const mudou = modelo !== f.modelo || (modelo === 'PERSONALIZADA' && campos.join() !== f.campos.join());
            if (mudou) {
              const ok = await executar(() => apiFaturas.ajustar(f.id, { modelo, campos }), 'Modelo guardado nesta fatura');
              if (!ok) return;
            } else onFechar();
            window.open(`/financeiro-ag/faturas/${encodeURIComponent(f.id)}/imprimir?modelo=${modelo}`, '_blank', 'noopener');
          },
        }}
        largura={640}
      >
        <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
          <legend className="mb-1 fin-t-caption font-medium text-[var(--fin-text-2)]">Modelo</legend>
          {MODELOS_DE_FATURA.map(m => (
            <label key={m} className={cn('flex cursor-pointer items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-3)] py-[var(--fin-s-2)]', modelo === m ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)]')}>
              <input type="radio" name="modelo-fatura" className="mt-1 size-4 accent-[var(--fin-accent)]" checked={modelo === m} onChange={() => setModelo(m)} />
              <span className="flex flex-col">
                <span className="fin-t-body-strong text-[var(--fin-text)]">{INFO_DO_MODELO[m].rotulo}</span>
                <span className="fin-t-caption text-[var(--fin-text-2)]">{INFO_DO_MODELO[m].ajuda}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {modelo === 'PERSONALIZADA' ? (
          <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
            <legend className="mb-1 fin-t-caption font-medium text-[var(--fin-text-2)]">Colunas que saem na fatura</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
              {CAMPOS_DA_FATURA.map(c => (
                <label key={c.id} className="flex items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)]">
                  <input type="checkbox" className="size-4 accent-[var(--fin-accent)]" disabled={c.id === 'valor'} checked={c.id === 'valor' || campos.includes(c.id)}
                    onChange={e => setCampos(atual => e.target.checked ? [...atual, c.id] : atual.filter(x => x !== c.id))} />
                  {c.rotulo}
                </label>
              ))}
            </div>
            <p className="fin-t-caption text-[var(--fin-text-3)]">O valor sai sempre. A escolha fica guardada nesta fatura.</p>
          </fieldset>
        ) : null}
      </RecordSheet>

      <RecordSheet
        aberto={aberto('retencoes')} onOpenChange={fechar} titulo="Retenções na fonte desta fatura"
        descricao="Os percentuais que o cliente retém ao pagar (vêm da regra de faturamento dele). O total a pagar, o boleto e o Pix saem pelo valor líquido."
        acaoPrimaria={{ rotulo: 'Guardar retenções', carregando: ocupado, onClick: () => { void executar(() => apiFaturas.ajustar(f.id, { retencoes: ret }), 'Retenções atualizadas'); } }}
        largura={480}
      >
        <div className="grid grid-cols-2 gap-[var(--fin-s-3)] sm:grid-cols-3">
          {(Object.keys(NOMES_DAS_RETENCOES) as Array<keyof typeof NOMES_DAS_RETENCOES>).map(k => (
            <Field key={k} rotulo={`${NOMES_DAS_RETENCOES[k]} (%)`}>
              {a => (
                <Input {...a} inputMode="decimal" value={ret[k] ? String(ret[k]).replace('.', ',') : ''} placeholder="0"
                  onChange={e => { const n = Number(e.target.value.replace(',', '.')); setRet(r => ({ ...r, [k]: Number.isFinite(n) && n >= 0 ? Math.min(100, n) : 0 })); }} />
              )}
            </Field>
          ))}
        </div>
        <Field rotulo="Calcular sobre">
          {a => (
            <select {...a} className={CONTROLE} value={ret.base} onChange={e => setRet(r => ({ ...r, base: e.target.value === 'TAXAS' ? 'TAXAS' : 'TOTAL' }))}>
              <option value="TOTAL">O total da fatura</option>
              <option value="TAXAS">Só as taxas de serviço (Taxa DU, RAV, Fee)</option>
            </select>
          )}
        </Field>
      </RecordSheet>
    </>
  );
}
