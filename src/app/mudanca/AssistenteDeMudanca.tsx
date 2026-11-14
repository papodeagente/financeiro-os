'use client';

import * as React from 'react';
import { FolderInput } from 'lucide-react';

import { Callout } from '@/components/fin/Callout';
import { DataState } from '@/components/fin/DataState';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { ProgressoDeEtapas } from '@/components/fin/ProgressoDeEtapas';
import { api, type FiltroDoEnsaio, type Lote } from '@/lib/migracao/contrato-telas';
import {
  ETAPAS, etapaInicial, indiceDaEtapa, jaAplicou, loteEncerrado, type IdDaEtapa,
} from '@/lib/migracao/telas/assistente';

import { textoDoErro } from './pecas';
import { PassoAplicar } from './passos/PassoAplicar';
import { PassoArquivos } from './passos/PassoArquivos';
import { PassoColunas } from './passos/PassoColunas';
import { PassoConcluir } from './passos/PassoConcluir';
import { PassoEnsaio } from './passos/PassoEnsaio';
import { PassoExportar } from './passos/PassoExportar';
import { PassoParalelo } from './passos/PassoParalelo';
import { PassoProvas } from './passos/PassoProvas';
import { PassoRecriar } from './passos/PassoRecriar';

/**
 * Mudar para o EnturOS (E4, 05/11/2026). Um assistente de 7 passos que traz
 * do sistema anterior as contas, categorias, centros, pessoas, contas em
 * aberto e saldos de abertura:
 *
 *   exportar → arquivos → colunas → ensaio → aplicar → provas → concluir
 *
 * Nada é gravado antes de "Aplicar" (com confirmação), e tudo o que foi
 * gravado pode ser desfeito. O assistente abre no passo em que a mudança
 * parou, então dá para fechar a tela no meio e voltar depois.
 */
export function AssistenteDeMudanca() {
  const [lote, setLote] = React.useState<Lote | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [etapa, setEtapa] = React.useState<IdDaEtapa>('exportar');
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [filtroDoEnsaio, setFiltroDoEnsaio] = React.useState<FiltroDoEnsaio | null>(null);
  const tituloRef = React.useRef<HTMLHeadingElement>(null);

  const carregar = React.useCallback(async () => {
    setEstado(atual => (atual === 'ok' ? 'ok' : 'carregando'));
    try {
      const { lotes } = await api.lotes();
      const atual = lotes[0] ?? null;
      setLote(atual);
      setEtapa(etapaInicial(atual));
      setErro(null);
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(textoDoErro(e));
      setEstado('erro');
    }
  }, []);

  React.useEffect(() => { void carregar(); }, [carregar]);

  const irPara = React.useCallback((id: IdDaEtapa) => {
    setEtapa(id);
    // O foco acompanha a troca de passo: quem usa teclado ou leitor de tela
    // não fica preso no botão que sumiu.
    requestAnimationFrame(() => tituloRef.current?.focus());
  }, []);

  const verNoEnsaio = React.useCallback((f: FiltroDoEnsaio) => {
    setFiltroDoEnsaio(f);
    irPara('ensaio');
  }, [irPara]);

  const novaMudanca = React.useCallback(() => {
    setLote(null);
    irPara('exportar');
  }, [irPara]);

  const atual = ETAPAS[indiceDaEtapa(etapa)];
  const props = { lote, onLote: setLote, irPara };
  const nadaSai = jaAplicou(lote) && !loteEncerrado(lote);

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={FolderInput}
        titulo="Mudar para o EnturOS"
        subtitulo="Traga do sistema anterior as contas, categorias, clientes e fornecedores, as contas em aberto, os saldos e, se quiser, o histórico. Nada é gravado antes de você ver o ensaio, e tudo pode ser desfeito."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
        acoesSecundarias={[
          { rotulo: 'Glossário', href: '/mudanca/glossario' },
          { rotulo: 'Registros trazidos', href: '/mudanca/historico' },
          { rotulo: 'Checklist de paridade', href: '/mudanca/paridade' },
        ]}
      />

      <DataState
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={
          <div className="flex flex-col gap-[var(--fin-s-5)]" aria-hidden="true">
            <div className="h-12 animate-pulse rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
            <div className="h-80 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
          </div>
        }
      >
        <div className="flex flex-col gap-[var(--fin-s-5)]">
          {nadaSai ? (
            <Callout tom="aviso" titulo="Durante a mudança, nada sai">
              Cobrança, WhatsApp, nota fiscal, comissão e avisos ao CRM ficam parados para tudo o que veio do sistema anterior. Eles voltam quando você concluir a mudança.
            </Callout>
          ) : null}

          <nav aria-label="Passos da mudança" className="flex flex-col gap-[var(--fin-s-2)]">
            <div className="hidden md:block">
              <ProgressoDeEtapas etapas={ETAPAS.map(e => e.rotulo)} atual={indiceDaEtapa(etapa)} />
            </div>
            <p className="fin-t-caption text-[var(--fin-text-2)] md:hidden">
              Passo {indiceDaEtapa(etapa) + 1} de {ETAPAS.length} · <span className="text-[var(--fin-text)]">{atual.rotulo}</span>
            </p>
          </nav>

          <section aria-labelledby="titulo-do-passo" className="flex flex-col gap-[var(--fin-s-5)]">
            <h2 id="titulo-do-passo" ref={tituloRef} tabIndex={-1} className="sr-only">{atual.titulo}</h2>
            {etapa === 'exportar' ? <PassoExportar {...props} onCarregar={carregar} /> : null}
            {etapa === 'arquivos' ? <PassoArquivos {...props} /> : null}
            {etapa === 'colunas' ? <PassoColunas {...props} /> : null}
            {etapa === 'ensaio' ? (
              <PassoEnsaio {...props} filtroInicial={filtroDoEnsaio} onFiltroUsado={() => setFiltroDoEnsaio(null)} />
            ) : null}
            {etapa === 'aplicar' ? <PassoAplicar {...props} onVerNoEnsaio={verNoEnsaio} /> : null}
            {etapa === 'provas' ? <PassoProvas {...props} onVerNoEnsaio={verNoEnsaio} /> : null}
            {etapa === 'concluir' ? <PassoConcluir {...props} onNovaMudanca={novaMudanca} /> : null}
            {etapa === 'recriar' ? <PassoRecriar {...props} /> : null}
            {etapa === 'paralelo' ? <PassoParalelo {...props} /> : null}
          </section>
        </div>
      </DataState>
    </MolduraDaPagina>
  );
}
