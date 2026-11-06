'use client';

import * as React from 'react';
import Link from 'next/link';
import { Ban, ChevronLeft, ChevronRight, FlaskConical, Link2, PlusCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import {
  api, ORDEM_DAS_LISTAS, type FiltroDoEnsaio, type LinhaDoEnsaio, type RespostaDoEnsaio, type ResultadoDaLinha, type TipoDeLista,
} from '@/lib/migracao/contrato-telas';
import {
  bloqueioDoEnsaio, ensaioEmDia, jaAplicou, resumoNaOrdem, totaisDoEnsaio,
} from '@/lib/migracao/telas/assistente';
import { ROTULO_DA_LISTA } from '@/lib/migracao/telas/listas';
import { formatBRL } from '@/lib/utils';
import { toast } from '@/lib/toast';

import { BarraDoPasso, CabecaDoPasso, PAINEL, contagem, textoDoErro, useDebounce, type PropsDoPasso } from '../pecas';

const POR_PAGINA = 50;
type Filtros = { resultado: ResultadoDaLinha | 'todos'; tipo_lista: TipoDeLista | 'todas'; busca: string; pagina: number };
const PADRAO: Filtros = { resultado: 'todos', tipo_lista: 'todas', busca: '', pagina: 1 };

/**
 * Passo 4 · Ensaio. O que vai ser criado, o que liga com o que já existe e
 * o que fica de fora, linha por linha e com o motivo, SEM gravar nada.
 * Depois de aplicado, continua aberto para consulta (as provas apontam para cá).
 */
export function PassoEnsaio({ lote, onLote, irPara, filtroInicial, onFiltroUsado }: PropsDoPasso & {
  filtroInicial: FiltroDoEnsaio | null; onFiltroUsado: () => void;
}) {
  const [f, setF] = React.useState<Filtros>(() => ({
    ...PADRAO,
    resultado: filtroInicial?.resultado ?? 'todos',
    tipo_lista: filtroInicial?.tipo_lista ?? 'todas',
    busca: filtroInicial?.busca ?? '',
  }));
  const [dados, setDados] = React.useState<RespostaDoEnsaio | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [rodando, setRodando] = React.useState(false);
  const [versao, setVersao] = React.useState(0);
  const busca = useDebounce(f.busca.trim());
  const emDia = ensaioEmDia(lote);
  const aplicou = jaAplicou(lote);
  const loteId = lote?.id;
  const situacao = lote?.situacao;

  React.useEffect(() => { if (filtroInicial) onFiltroUsado(); }, [filtroInicial, onFiltroUsado]);

  // Ensaio rodando no servidor: pergunta o lote até terminar.
  React.useEffect(() => {
    if (!loteId || situacao !== 'ensaiando') return;
    let vivo = true;
    const t = setInterval(async () => {
      try { const l = await api.lote(loteId); if (vivo && l.situacao !== 'ensaiando') onLote(l); } catch { /* tenta de novo */ }
    }, 2000);
    return () => { vivo = false; clearInterval(t); };
  }, [loteId, situacao, onLote]);

  React.useEffect(() => {
    if (!loteId || (!emDia && !aplicou) || situacao === 'ensaiando') return;
    const ac = new AbortController();
    setCarregando(true);
    api.ensaio(loteId, { resultado: f.resultado, tipo_lista: f.tipo_lista, busca: busca || undefined, pagina: f.pagina, por_pagina: POR_PAGINA }, ac.signal)
      .then(r => { setDados(r); setErro(null); })
      .catch(e => { if (!ac.signal.aborted) setErro(textoDoErro(e)); })
      .finally(() => { if (!ac.signal.aborted) setCarregando(false); });
    return () => ac.abort();
  }, [loteId, emDia, aplicou, situacao, f.resultado, f.tipo_lista, f.pagina, busca, versao]);

  async function rodar() {
    if (!lote) return;
    setRodando(true);
    try { onLote(await api.ensaiar(lote.id)); } catch (e) { toast.error(textoDoErro(e)); } finally { setRodando(false); }
  }

  const mudar = (p: Partial<Filtros>) => setF(a => ({ ...a, pagina: 1, ...p }));
  const resumo = dados?.resumo ?? lote?.resumo_do_ensaio ?? null;
  const t = totaisDoEnsaio(resumo);
  const ativos = (f.resultado !== 'todos' ? 1 : 0) + (f.tipo_lista !== 'todas' ? 1 : 0) + (f.busca ? 1 : 0);
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.por_pagina)) : 1;
  const listasPresentes = resumoNaOrdem(resumo).map(r => r.tipo_lista);

  if (!lote) return null;

  if (situacao === 'ensaiando') {
    return (
      <>
        <CabecaDoPasso id="passo-ensaio" titulo="Ensaio: o que vai acontecer" />
        <Callout tom="info" titulo="O ensaio está rodando">
          Lendo cada linha, ligando com o que já existe aqui e separando o que não pode entrar. Nada é gravado. Esta tela atualiza sozinha.
        </Callout>
      </>
    );
  }

  if (!emDia && !aplicou) {
    return (
      <>
        <CabecaDoPasso id="passo-ensaio" titulo="Ensaio: o que vai acontecer" />
        <Callout
          tom={lote.versao_do_ensaio === null ? 'info' : 'aviso'}
          titulo={lote.versao_do_ensaio === null ? 'O ensaio ainda não rodou' : 'O ensaio ficou para trás'}
          acao={{ rotulo: 'Rodar o ensaio', onClick: () => { void rodar(); }, carregando: rodando }}
        >
          {lote.versao_do_ensaio === null
            ? 'O ensaio lê os arquivos e mostra o que seria criado, ligado ou recusado, sem gravar nada.'
            : 'Um arquivo ou uma coluna mudou depois do último ensaio. Rode de novo para ver o resultado de agora.'}
        </Callout>
        <BarraDoPasso voltar={{ rotulo: 'Colunas', onClick: () => irPara('colunas') }} />
      </>
    );
  }

  const colunas: FinColuna<LinhaDoEnsaio>[] = [
    {
      id: 'origem', cabecalho: 'Linha', tipo: 'texto', minWidth: 150, prioridade: 2,
      render: l => (
        <span className="flex min-w-0 flex-col">
          <span className="fin-t-body tabular-nums text-[var(--fin-text)]">Linha {l.linha}</span>
          <span className="max-w-[22ch] truncate fin-t-caption text-[var(--fin-text-3)]" title={l.arquivo_nome}>{l.arquivo_nome}</span>
        </span>
      ),
    },
    {
      id: 'descricao', cabecalho: 'O que é', tipo: 'texto', minWidth: 240,
      render: l => (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-[48ch] truncate fin-t-body-strong text-[var(--fin-text)]" title={l.descricao}>{l.descricao}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{ROTULO_DA_LISTA[l.tipo_lista]}</span>
        </span>
      ),
    },
    { id: 'resultado', cabecalho: 'Resultado', tipo: 'status', valor: l => l.resultado, dominio: 'mudanca' },
    {
      id: 'valor', cabecalho: 'Valor', tipo: 'texto', minWidth: 112, prioridade: 3,
      render: l => <span className="block text-right fin-t-body tabular-nums text-[var(--fin-text)]">{l.valor === null ? '—' : formatBRL(l.valor)}</span>,
    },
    {
      id: 'motivo', cabecalho: 'Por quê', tipo: 'texto', minWidth: 240,
      render: l => (
        <span className="flex max-w-[52ch] flex-col gap-0.5 fin-t-body text-[var(--fin-text-2)]">
          {l.vinculo ? (
            <span>
              Liga com{' '}
              {l.vinculo.href
                ? <Link href={l.vinculo.href} className="text-[var(--fin-accent)] underline-offset-2 hover:underline">{l.vinculo.rotulo}</Link>
                : <span className="text-[var(--fin-text)]">{l.vinculo.rotulo}</span>}
            </span>
          ) : null}
          {l.motivo ? <span className={l.resultado === 'recusar' ? 'text-[var(--fin-negative-text)]' : undefined}>{l.motivo}</span> : null}
          {!l.vinculo && !l.motivo ? <span className="text-[var(--fin-text-3)]">—</span> : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <CabecaDoPasso id="passo-ensaio" titulo="Ensaio: o que vai acontecer">
        {aplicou
          ? 'Este é o ensaio que foi aplicado. Fica aqui para consulta: cada diferença das provas aponta para as linhas que a explicam.'
          : 'Nada foi gravado ainda. Confira o que vai ser criado, o que liga com o que já existe aqui e o que fica de fora, com o motivo.'}
      </CabecaDoPasso>

      <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
        <MetricCard
          rotulo="Serão criados" icone={PlusCircle} valor={t.criar} formato="contagem" estado="ok" tomDoIcone="positivo"
          contexto="Registros novos: entram aqui como vieram do arquivo."
          onClick={() => mudar({ resultado: f.resultado === 'criar' ? 'todos' : 'criar' })} ativo={f.resultado === 'criar'}
        />
        <MetricCard
          rotulo="Ligam com o que já existe" icone={Link2} valor={t.vincular} formato="contagem" estado="ok"
          contexto="Mesmo CPF/CNPJ, mesma conta ou mesma categoria: nada é duplicado."
          onClick={() => mudar({ resultado: f.resultado === 'vincular' ? 'todos' : 'vincular' })} ativo={f.resultado === 'vincular'}
        />
        <MetricCard
          rotulo="Recusados" icone={Ban} valor={t.recusar} formato="contagem" estado="ok" tone={t.recusar ? 'negativo' : 'neutro'} tomDoIcone="negativo"
          contexto={t.recusar ? 'Ficam de fora. O motivo está em cada linha.' : 'Nenhuma linha ficou de fora.'}
          onClick={() => mudar({ resultado: f.resultado === 'recusar' ? 'todos' : 'recusar' })} ativo={f.resultado === 'recusar'}
        />
      </div>

      <div className={`${PAINEL} overflow-x-auto`}>
        <table className="w-full min-w-[520px] fin-t-body">
          <caption className="sr-only">Resultado do ensaio por lista</caption>
          <thead>
            <tr className="border-b border-[var(--fin-border)] text-left fin-t-overline text-[var(--fin-text-3)]">
              <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] font-medium">Lista</th>
              <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-right font-medium">Criar</th>
              <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-right font-medium">Ligar</th>
              <th scope="col" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-right font-medium">Recusar</th>
            </tr>
          </thead>
          <tbody>
            {resumoNaOrdem(resumo).map(r => (
              <tr key={r.tipo_lista} className="border-b border-[var(--fin-border)] last:border-0">
                <th scope="row" className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-left font-normal">
                  <button
                    type="button"
                    onClick={() => mudar({ tipo_lista: r.tipo_lista })}
                    className="text-[var(--fin-text)] underline-offset-2 hover:text-[var(--fin-accent)] hover:underline"
                  >
                    {ROTULO_DA_LISTA[r.tipo_lista]}
                  </button>
                </th>
                <td className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-right tabular-nums">{contagem(r.criar)}</td>
                <td className="px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-right tabular-nums">{contagem(r.vincular)}</td>
                <td className={`px-[var(--fin-s-4)] py-[var(--fin-s-2)] text-right tabular-nums ${r.recusar ? 'text-[var(--fin-negative-text)]' : ''}`}>{contagem(r.recusar)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FilterBar
        busca={{ valor: f.busca, onChange: v => mudar({ busca: v }), placeholder: 'Pesquisar nome, documento ou motivo…' }}
        selects={[
          {
            id: 'ensaio-resultado', rotulo: 'Resultado', valor: f.resultado, onChange: v => mudar({ resultado: v as Filtros['resultado'] }),
            opcoes: [
              { valor: 'todos', rotulo: 'Todos' }, { valor: 'criar', rotulo: 'Serão criados' },
              { valor: 'vincular', rotulo: 'Ligam com existente' }, { valor: 'recusar', rotulo: 'Recusados' },
            ],
          },
          {
            id: 'ensaio-lista', rotulo: 'Lista', valor: f.tipo_lista, onChange: v => mudar({ tipo_lista: v as Filtros['tipo_lista'] }),
            opcoes: [
              { valor: 'todas', rotulo: 'Todas' },
              ...ORDEM_DAS_LISTAS.filter(x => listasPresentes.includes(x)).map(x => ({ valor: x, rotulo: ROTULO_DA_LISTA[x] })),
            ],
          },
        ]}
        resumo={{ exibidos: dados?.total ?? 0, total: t.total, substantivo: t.total === 1 ? 'linha' : 'linhas' }}
        ativos={ativos}
        onLimpar={() => setF(PADRAO)}
      />

      <FinTable<LinhaDoEnsaio>
        linhas={dados?.linhas ?? []}
        colunas={colunas}
        chave={l => l.id}
        densidade="compacta"
        estado={!dados && carregando ? 'carregando' : !dados && erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => setVersao(v => v + 1) } : null}
        vazio={ativos > 0
          ? { motivo: 'sem-resultado', titulo: 'Nenhuma linha neste filtro', oQueE: 'O ensaio continua inteiro; o recorte é que não achou nada.', acaoSecundaria: { rotulo: 'Limpar filtros', onClick: () => setF(PADRAO) } }
          : { motivo: 'sem-dado', titulo: 'O ensaio não achou linhas', oQueE: 'Os arquivos foram lidos, mas nenhuma linha virou registro. Confira as colunas.', acao: aplicou ? undefined : { rotulo: 'Voltar às colunas', onClick: () => irPara('colunas') } }}
        rodape={dados && paginas > 1 ? (
          <div className="flex items-center justify-between gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-2)]">
            <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">Página {f.pagina} de {paginas}</span>
            <span className="flex gap-1">
              <Button variant="outline" size="sm" disabled={f.pagina <= 1} onClick={() => setF(a => ({ ...a, pagina: a.pagina - 1 }))}>
                <ChevronLeft aria-hidden="true" /> Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={f.pagina >= paginas} onClick={() => setF(a => ({ ...a, pagina: a.pagina + 1 }))}>
                Próxima <ChevronRight aria-hidden="true" />
              </Button>
            </span>
          </div>
        ) : undefined}
      />
      {carregando && dados ? <span className="sr-only" role="status">Atualizando as linhas.</span> : null}

      {aplicou ? (
        <BarraDoPasso principal={{ rotulo: 'Voltar às provas', onClick: () => irPara('provas') }} />
      ) : (
        <BarraDoPasso
          voltar={{ rotulo: 'Colunas', onClick: () => irPara('colunas') }}
          bloqueio={bloqueioDoEnsaio(lote)}
          extra={
            <Button variant="outline" onClick={() => { void rodar(); }} disabled={rodando} className="max-sm:w-full">
              <FlaskConical aria-hidden="true" /> Rodar de novo
            </Button>
          }
          principal={{ rotulo: 'Seguir para aplicar', onClick: () => irPara('aplicar') }}
        />
      )}
    </>
  );
}
