'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info, Loader2, Trash2, UploadCloud, XCircle } from 'lucide-react';

import { ChecklistViva, type ItemDaChecklist } from '@/components/fin/ChecklistViva';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { api, ORDEM_DAS_LISTAS, type ArquivoDoLote, type TipoDeLista } from '@/lib/migracao/contrato-telas';
import {
  bloqueioDosArquivos, dataBR, listasSemArquivo, mesesFaltando, nomeDoMes, ordenarArquivos, problemaDoArquivoLocal,
  textoDoAviso, listaEmFrase,
} from '@/lib/migracao/telas/assistente';
import { GUIA_DE_EXPORTACAO, ROTULO_DA_LISTA } from '@/lib/migracao/telas/listas';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

import { BarraDoPasso, CabecaDoPasso, CONTROLE, PAINEL, contagem, plural, textoDoErro, type PropsDoPasso } from '../pecas';

interface Envio { chave: string; nome: string; estado: 'na_fila' | 'enviando' | 'falhou'; erro?: string }

const ACEITOS = '.xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain';

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

/**
 * Passo 2 · Soltar os arquivos. Vários de uma vez, por arrastar ou escolher.
 * Cada arquivo é lido no servidor na hora (lista, linhas, período e avisos),
 * mas nada entra no financeiro: isso só acontece no passo Aplicar.
 */
export function PassoArquivos({ lote, onLote, irPara }: PropsDoPasso) {
  const [envios, setEnvios] = React.useState<Envio[]>([]);
  const [arrastando, setArrastando] = React.useState(false);
  const [remover, setRemover] = React.useState<ArquivoDoLote | null>(null);
  const [removendo, setRemovendo] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const loteRef = React.useRef(lote);
  loteRef.current = lote;

  const arquivos = React.useMemo(() => ordenarArquivos(lote?.arquivos ?? []), [lote]);
  const enviando = envios.some(e => e.estado !== 'falhou');

  async function receber(lista: FileList | File[]) {
    if (!lote) return;
    const novos = Array.from(lista);
    if (novos.length === 0) return;
    const fila: Array<{ envio: Envio; arquivo: File }> = novos.map((arquivo, i) => {
      const problema = problemaDoArquivoLocal(arquivo.name, arquivo.size);
      return {
        arquivo,
        envio: { chave: `${Date.now()}-${i}-${arquivo.name}`, nome: arquivo.name, estado: problema ? 'falhou' : 'na_fila', erro: problema ?? undefined },
      };
    });
    setEnvios(atual => [...atual, ...fila.map(f => f.envio)]);

    // Um de cada vez: o servidor lê cada planilha inteira, e a pessoa vê
    // cada arquivo chegando em vez de uma espera muda.
    for (const { envio, arquivo } of fila) {
      if (envio.estado === 'falhou') continue;
      setEnvios(atual => atual.map(e => (e.chave === envio.chave ? { ...e, estado: 'enviando' } : e)));
      try {
        const lido = await api.enviarArquivo(lote.id, arquivo);
        const base = loteRef.current ?? lote;
        onLote({ ...base, arquivos: [...base.arquivos.filter(a => a.id !== lido.id), lido] });
        setEnvios(atual => atual.filter(e => e.chave !== envio.chave));
      } catch (e) {
        setEnvios(atual => atual.map(x => (x.chave === envio.chave ? { ...x, estado: 'falhou', erro: textoDoErro(e) } : x)));
      }
    }
    // A versão do lote mudou com os arquivos: busca o lote inteiro de novo.
    try { onLote(await api.lote(lote.id)); } catch { /* a lista local já está certa */ }
  }

  async function escolherLista(a: ArquivoDoLote, tipo: TipoDeLista) {
    if (!lote) return;
    try {
      const novo = await api.escolherLista(lote.id, a.id, tipo);
      onLote(await api.lote(lote.id).catch(() => ({ ...lote, arquivos: lote.arquivos.map(x => (x.id === novo.id ? novo : x)) })));
    } catch (e) {
      toast.error(textoDoErro(e));
    }
  }

  async function confirmarRemocao() {
    if (!lote || !remover) return;
    setRemovendo(true);
    try {
      onLote(await api.removerArquivo(lote.id, remover.id));
      setRemover(null);
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setRemovendo(false);
    }
  }

  const faltamMeses = mesesFaltando(arquivos);
  const semArquivo = listasSemArquivo(arquivos);
  const bloqueio = enviando ? 'Espere os arquivos terminarem de chegar.' : bloqueioDosArquivos(arquivos);

  const chegou: ItemDaChecklist[] = GUIA_DE_EXPORTACAO.map(g => {
    const desta = arquivos.filter(a => a.tipo_lista === g.tipo);
    const linhas = desta.reduce((s, a) => s + a.linhas, 0);
    return {
      chave: g.tipo,
      titulo: g.nome,
      estado: desta.length ? 'feito' : 'aguardando',
      detalhe: desta.length
        ? `${plural(desta.length, 'arquivo', 'arquivos')} · ${plural(linhas, 'linha', 'linhas')}`
        : g.opcional ? 'Opcional' : 'Ainda sem arquivo',
    };
  });

  const colunas: FinColuna<ArquivoDoLote>[] = [
    {
      id: 'arquivo', cabecalho: 'Arquivo', tipo: 'texto', minWidth: 220, acessor: a => a.nome.toLowerCase(), sortable: true,
      render: a => (
        <span className="flex min-w-0 items-start gap-[var(--fin-s-2)]">
          {a.erro
            ? <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-negative)]" />
            : <FileSpreadsheet aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-3)]" />}
          <span className="flex min-w-0 flex-col">
            <span className="truncate fin-t-body-strong text-[var(--fin-text)]" title={a.nome}>{a.nome}</span>
            <span className="fin-t-caption text-[var(--fin-text-3)]">{a.formato.toUpperCase()} · {tamanhoLegivel(a.tamanho)}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'lista', cabecalho: 'Lista', tipo: 'texto', minWidth: 200,
      render: a => (
        <select
          aria-label={`De qual lista é ${a.nome}`}
          value={a.tipo_lista ?? ''}
          disabled={Boolean(a.erro)}
          onChange={e => { void escolherLista(a, e.target.value as TipoDeLista); }}
          className={cn(CONTROLE, 'h-9 lg:h-9 max-lg:h-11', !a.tipo_lista && !a.erro && 'border-[var(--fin-warning)]')}
        >
          {!a.tipo_lista ? <option value="" disabled>Escolha a lista</option> : null}
          {ORDEM_DAS_LISTAS.map(t => <option key={t} value={t}>{ROTULO_DA_LISTA[t]}</option>)}
        </select>
      ),
    },
    {
      id: 'conteudo', cabecalho: 'O que veio', tipo: 'texto', minWidth: 220,
      render: a => {
        if (a.erro) return <span className="fin-t-body text-[var(--fin-negative-text)]">{a.erro}</span>;
        return (
          <span className="flex flex-col gap-1">
            <span className="fin-t-body tabular-nums text-[var(--fin-text)]">
              {plural(a.linhas, 'linha', 'linhas')}
              {a.periodo ? <span className="text-[var(--fin-text-3)]"> · {dataBR(a.periodo.de)} a {dataBR(a.periodo.ate)}</span> : null}
            </span>
            {a.avisos.map(av => {
              const t = textoDoAviso(av);
              const Icone = t.tom === 'aviso' ? AlertTriangle : Info;
              return (
                <span key={av.codigo} className={cn('flex items-start gap-1 fin-t-caption', t.tom === 'aviso' ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-text-2)]')}>
                  <Icone aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span className="max-w-[48ch]">{t.texto}</span>
                </span>
              );
            })}
          </span>
        );
      },
    },
    {
      id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: a => (
        <button
          type="button"
          onClick={() => setRemover(a)}
          aria-label={`Tirar o arquivo ${a.nome}`}
          title="Tirar este arquivo"
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] max-lg:size-11',
            'hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
          )}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      ),
    },
  ];

  return (
    <>
      <CabecaDoPasso id="passo-arquivos" titulo="Solte os arquivos">
        Pode soltar todos de uma vez: cada arquivo é lido e reconhecido sozinho. Ler não grava nada no financeiro.
      </CabecaDoPasso>

      <div className="grid grid-cols-1 gap-[var(--fin-s-5)] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-[var(--fin-s-4)]">
          <label
            onDragOver={e => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={e => { e.preventDefault(); setArrastando(false); void receber(e.dataTransfer.files); }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border-2 border-dashed px-[var(--fin-s-5)] py-[var(--fin-s-6)] text-center',
              'transition-colors duration-[var(--fin-dur-rapida)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--fin-accent)]',
              arrastando ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface)] hover:bg-[var(--fin-surface-2)]',
            )}
          >
            <UploadCloud aria-hidden="true" className={cn('size-8', arrastando ? 'text-[var(--fin-accent)]' : 'text-[var(--fin-text-3)]')} />
            <span className="fin-t-body-strong text-[var(--fin-text)]">Arraste os arquivos para cá</span>
            <span className="fin-t-body text-[var(--fin-text-2)]">ou <span className="text-[var(--fin-accent)] underline underline-offset-2">escolha no computador</span>, vários de uma vez</span>
            <span className="fin-t-caption text-[var(--fin-text-3)]">Excel (.xlsx ou .xls), CSV ou texto (.txt), até 20 MB cada</span>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACEITOS}
              className="sr-only"
              onChange={e => { if (e.target.files) void receber(e.target.files); e.target.value = ''; }}
            />
          </label>

          {envios.length ? (
            <ul className="flex flex-col gap-1" aria-live="polite">
              {envios.map(e => (
                <li key={e.chave} className="flex items-start gap-[var(--fin-s-2)] fin-t-body">
                  {e.estado === 'falhou'
                    ? <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-negative)]" />
                    : <Loader2 aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0 text-[var(--fin-accent)]', e.estado === 'enviando' && 'animate-spin')} />}
                  <span className="min-w-0">
                    <span className="text-[var(--fin-text)]">{e.nome}</span>
                    <span className={e.estado === 'falhou' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]'}>
                      {' · '}{e.estado === 'falhou' ? e.erro : e.estado === 'enviando' ? 'lendo…' : 'na fila'}
                    </span>
                  </span>
                  {e.estado === 'falhou' ? (
                    <button
                      type="button"
                      onClick={() => setEnvios(atual => atual.filter(x => x.chave !== e.chave))}
                      className="ml-auto shrink-0 fin-t-caption text-[var(--fin-text-2)] underline-offset-2 hover:underline"
                    >
                      Dispensar
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {faltamMeses.length ? (
            <p role="status" className="flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] px-3 py-2 fin-t-body text-[var(--fin-warning-text)]">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                Nas contas a pagar e a receber falta {faltamMeses.length === 1 ? 'o mês' : 'os meses'} {listaEmFrase(faltamMeses.map(nomeDoMes))}, entre o primeiro e o último arquivo. Se havia conta em aberto nesse período, exporte e solte aqui.
              </span>
            </p>
          ) : null}

          <FinTable<ArquivoDoLote>
            linhas={arquivos}
            colunas={colunas}
            chave={a => a.id}
            densidade="compacta"
            estado="ok"
            vazio={{
              motivo: 'sem-dado',
              titulo: 'Nenhum arquivo ainda',
              oQueE: 'Os arquivos exportados do sistema anterior aparecem aqui, com a lista de cada um, as linhas lidas e os avisos.',
              comoComeca: [
                'Exporte as listas como no passo anterior.',
                'Arraste todos para o quadro acima, de uma vez.',
                'Confira se cada arquivo caiu na lista certa.',
              ],
              acao: { rotulo: 'Escolher arquivos', onClick: () => inputRef.current?.click() },
            }}
          />
        </div>

        <aside aria-label="O que já chegou" className={`${PAINEL} flex h-fit flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`}>
          <h3 className="fin-t-body-strong text-[var(--fin-text)]">O que já chegou</h3>
          <ChecklistViva itens={chegou} />
          {semArquivo.length && arquivos.length ? (
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              Dá para seguir sem {semArquivo.length === 1 ? 'esta lista' : 'estas listas'} e trazer depois. O ensaio mostra o que depende delas.
            </p>
          ) : null}
          {arquivos.length ? (
            <p className="flex items-center gap-1.5 fin-t-caption text-[var(--fin-text-3)]">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              {plural(arquivos.length, 'arquivo', 'arquivos')} · {contagem(arquivos.reduce((s, a) => s + a.linhas, 0))} linhas no total
            </p>
          ) : null}
        </aside>
      </div>

      <BarraDoPasso
        voltar={{ rotulo: 'O que exportar', onClick: () => irPara('exportar') }}
        bloqueio={bloqueio}
        principal={{ rotulo: 'Conferir as colunas', onClick: () => irPara('colunas') }}
      />

      <ConfirmDialog
        aberto={Boolean(remover)}
        onOpenChange={a => { if (!a) setRemover(null); }}
        titulo="Tirar este arquivo da mudança?"
        oQueVaiAcontecer="O arquivo sai desta mudança e as linhas dele não entram no ensaio. Nada do financeiro é apagado. Dá para soltar de novo depois."
        detalhes={remover ? [
          { rotulo: 'Arquivo', valor: remover.nome },
          { rotulo: 'Lista', valor: remover.tipo_lista ? ROTULO_DA_LISTA[remover.tipo_lista] : 'Não reconhecida' },
          { rotulo: 'Linhas', valor: contagem(remover.linhas) },
        ] : undefined}
        confirmarRotulo="Tirar o arquivo"
        tone="destrutivo"
        processando={removendo}
        onConfirmar={confirmarRemocao}
      />
    </>
  );
}
