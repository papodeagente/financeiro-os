'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical } from 'lucide-react';

import { DataState } from '@/components/fin/DataState';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { api, type ColunaDoArquivo, type MapeamentoDoArquivo } from '@/lib/migracao/contrato-telas';
import {
  bloqueioDasColunas, camposFaltando, camposRepetidos, colunasIgnoradas, listaEmFrase, ordenarArquivos,
} from '@/lib/migracao/telas/assistente';
import { ROTULO_DA_LISTA } from '@/lib/migracao/telas/listas';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

import { BarraDoPasso, CabecaDoPasso, CONTROLE, PAINEL, textoDoErro, type PropsDoPasso } from '../pecas';

const IGNORAR = '__ignorar__';

/**
 * Passo 3 · Conferir as colunas. Para cada arquivo, cada coluna do sistema
 * anterior e para onde ela vai aqui, já sugerido pelo cabeçalho. A pessoa só
 * escolhe numa lista; nunca escreve fórmula nem nome de campo.
 */
export function PassoColunas({ lote, onLote, irPara }: PropsDoPasso) {
  const [mapas, setMapas] = React.useState<MapeamentoDoArquivo[] | null>(null);
  const [mudados, setMudados] = React.useState<Set<string>>(new Set());
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    if (!lote) return;
    setEstado('carregando');
    try {
      const r = await api.mapeamento(lote.id);
      // Mesma ordem dos arquivos no passo anterior (ordem de aplicação).
      const ordem = ordenarArquivos(lote.arquivos).map(a => a.id);
      setMapas([...r.arquivos].sort((a, b) => ordem.indexOf(a.arquivo_id) - ordem.indexOf(b.arquivo_id)));
      setMudados(new Set());
      setEstado('ok');
    } catch (e) {
      setErro(textoDoErro(e));
      setEstado('erro');
    }
    // Recarrega quando os arquivos mudam, não a cada troca de versão do lote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lote?.id, lote?.arquivos.length]);

  React.useEffect(() => { void carregar(); }, [carregar]);

  function escolher(arquivoId: string, indice: number, campo: string | null) {
    setMapas(atual => atual?.map(m => (m.arquivo_id !== arquivoId ? m : {
      ...m, colunas: m.colunas.map(c => (c.indice === indice ? { ...c, campo } : c)),
    })) ?? null);
    setMudados(atual => new Set(atual).add(arquivoId));
  }

  async function salvarEEnsaiar() {
    if (!lote || !mapas) return;
    setSalvando(true);
    try {
      for (const m of mapas) {
        if (!mudados.has(m.arquivo_id)) continue;
        await api.salvarMapeamento(lote.id, {
          arquivo_id: m.arquivo_id, tipo_lista: m.tipo_lista, colunas: m.colunas.map(c => ({ indice: c.indice, campo: c.campo })),
        });
      }
      setMudados(new Set());
      // O ensaio só lê e mostra: nada é gravado no financeiro.
      onLote(await api.ensaiar(lote.id));
      irPara('ensaio');
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const bloqueio = mapas ? bloqueioDasColunas(mapas) : 'Carregando as colunas…';

  return (
    <>
      <CabecaDoPasso id="passo-colunas" titulo="Confira as colunas">
        Cada coluna do arquivo já vem ligada ao campo daqui pelo nome do cabeçalho. Confira as marcadas para conferir e escolha o que faltar. Coluna sem destino fica de fora.
      </CabecaDoPasso>

      <DataState
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={<div aria-hidden="true" className="h-72 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
      >
        <div className="flex flex-col gap-[var(--fin-s-5)]">
          {(mapas ?? []).map(m => (
            <ColunasDeUmArquivo key={m.arquivo_id} mapa={m} mudado={mudados.has(m.arquivo_id)} onEscolher={(i, c) => escolher(m.arquivo_id, i, c)} />
          ))}
          {mapas && mapas.length === 0 ? (
            <p className="fin-t-body text-[var(--fin-text-2)]">Nenhum arquivo lido para conferir. Volte e solte os arquivos.</p>
          ) : null}
        </div>
      </DataState>

      <BarraDoPasso
        voltar={{ rotulo: 'Arquivos', onClick: () => irPara('arquivos') }}
        bloqueio={estado === 'ok' ? bloqueio : null}
        principal={{
          rotulo: mudados.size ? 'Salvar as colunas e rodar o ensaio' : 'Rodar o ensaio',
          icone: FlaskConical,
          onClick: () => { void salvarEEnsaiar(); },
          carregando: salvando,
        }}
      />
    </>
  );
}

function ColunasDeUmArquivo({ mapa, mudado, onEscolher }: {
  mapa: MapeamentoDoArquivo; mudado: boolean; onEscolher: (indice: number, campo: string | null) => void;
}) {
  const faltando = camposFaltando(mapa);
  const repetidos = new Set(camposRepetidos(mapa));
  const ignoradas = colunasIgnoradas(mapa);
  const rotuloDoCampo = new Map(mapa.campos.map(c => [c.campo, c.rotulo]));
  const ok = faltando.length === 0 && repetidos.size === 0;
  const idTitulo = `colunas-${mapa.arquivo_id}`;

  const colunas: FinColuna<ColunaDoArquivo>[] = [
    {
      id: 'origem', cabecalho: 'Coluna do arquivo', tipo: 'texto', minWidth: 180,
      render: c => <span className="fin-t-body-strong text-[var(--fin-text)]">{c.cabecalho || `Coluna ${c.indice + 1}`}</span>,
    },
    {
      id: 'exemplos', cabecalho: 'Exemplos', tipo: 'texto', minWidth: 200, prioridade: 2,
      render: c => (
        <span className="block max-w-[36ch] truncate fin-t-caption text-[var(--fin-text-2)]" title={c.exemplos.join(' · ')}>
          {c.exemplos.length ? c.exemplos.join(' · ') : 'vazia nas primeiras linhas'}
        </span>
      ),
    },
    {
      id: 'destino', cabecalho: 'Vai para', tipo: 'texto', minWidth: 220,
      render: c => {
        const repetido = c.campo ? repetidos.has(rotuloDoCampo.get(c.campo) ?? '') : false;
        const conferir = c.campo !== null && c.campo === c.sugerido && c.confianca === 'provavel';
        return (
          <span className="flex flex-col gap-1">
            <select
              aria-label={`Para onde vai a coluna ${c.cabecalho || c.indice + 1}`}
              value={c.campo ?? IGNORAR}
              onChange={e => onEscolher(c.indice, e.target.value === IGNORAR ? null : e.target.value)}
              aria-invalid={repetido || undefined}
              className={cn(CONTROLE, 'h-9 lg:h-9 max-lg:h-11', repetido && 'border-[var(--fin-negative)]', !c.campo && 'text-[var(--fin-text-3)]')}
            >
              <option value={IGNORAR}>Não trazer esta coluna</option>
              {mapa.campos.map(campo => (
                <option key={campo.campo} value={campo.campo}>{campo.rotulo}{campo.obrigatorio ? ' (obrigatório)' : ''}</option>
              ))}
            </select>
            {repetido ? <span className="fin-t-caption text-[var(--fin-negative-text)]">Outra coluna já vai para este campo.</span> : null}
            {!repetido && conferir ? <span className="fin-t-caption text-[var(--fin-warning-text)]">Sugestão pelo nome: confira.</span> : null}
            {!c.campo && c.confianca === 'nenhuma' ? <span className="fin-t-caption text-[var(--fin-text-3)]">Cabeçalho não reconhecido.</span> : null}
          </span>
        );
      },
    },
  ];

  return (
    <section aria-labelledby={idTitulo} className={`${PAINEL} flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)] sm:p-[var(--fin-s-5)]`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-[var(--fin-s-4)]">
        <div className="flex min-w-0 flex-col">
          <h3 id={idTitulo} className="truncate fin-t-subhead text-[var(--fin-text)]" title={mapa.arquivo_nome}>{mapa.arquivo_nome}</h3>
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            {ROTULO_DA_LISTA[mapa.tipo_lista]} · {mapa.colunas.length} colunas{mudado ? ' · alterado, salva ao rodar o ensaio' : ''}
          </p>
        </div>
        {ok ? (
          <span className="inline-flex shrink-0 items-center gap-1 fin-t-caption text-[var(--fin-positive)]">
            <CheckCircle2 aria-hidden="true" className="size-3.5" /> Tudo que é obrigatório tem coluna
          </span>
        ) : null}
      </div>

      {faltando.length ? (
        <p role="alert" className="flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] px-3 py-2 fin-t-body text-[var(--fin-negative-text)]">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>Falta dizer qual coluna é {listaEmFrase(faltando)}. Se o arquivo não tem essa coluna, exporte de novo com ela visível.</span>
        </p>
      ) : null}

      <FinTable<ColunaDoArquivo>
        linhas={mapa.colunas}
        colunas={colunas}
        chave={c => String(c.indice)}
        densidade="compacta"
        estado="ok"
        vazio={{ motivo: 'sem-dado', titulo: 'Arquivo sem colunas', oQueE: 'O leitor não achou cabeçalho neste arquivo. Exporte de novo com os títulos das colunas na primeira linha.' }}
      />

      {ignoradas.length ? (
        <p className="fin-t-caption text-[var(--fin-text-3)]">Ficam de fora: {listaEmFrase(ignoradas)}.</p>
      ) : null}
    </section>
  );
}
