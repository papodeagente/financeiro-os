'use client';

import * as React from 'react';
import Link from 'next/link';
import { Archive } from 'lucide-react';

import { Callout } from '@/components/fin/Callout';
import { DataState } from '@/components/fin/DataState';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { Segmentado } from '@/components/fin/Segmentado';
import { dataBR } from '@/lib/migracao/telas/assistente';

type Tipo = 'faturas' | 'notas' | 'comissoes_pagas';

interface Registro {
  id: string;
  tipo: Tipo;
  data: string | null;
  valor: number;
  pessoa: string;
  numero: string;
  venda_id: string;
  dados: Record<string, unknown>;
  arquivo: string;
  linha: number | null;
}

const ROTULO: Record<Tipo, string> = { faturas: 'Faturas ao cliente', notas: 'Notas emitidas', comissoes_pagas: 'Comissões já pagas' };
const FRASE: Record<Tipo, string> = {
  faturas: 'As faturas que o sistema anterior emitiu. As novas nascem aqui, pelas regras de faturamento.',
  notas: 'As notas que o sistema anterior emitiu. Nota trazida nunca é emitida de novo.',
  comissoes_pagas: 'O que já foi pago de comissão lá. As vendas trazidas não entram no cálculo de comissão daqui, então nada é pago duas vezes.',
};
const txt = (v: unknown) => (v == null ? '' : String(v));

/**
 * Registros trazidos do sistema anterior (E7): faturas, notas emitidas e
 * comissões já pagas. Só consulta: nada aqui cobra, emite ou paga. Cada linha
 * diz de que arquivo e linha veio; a venda trazida abre na ficha.
 */
export function TelaDosRegistros() {
  const [tipo, setTipo] = React.useState<Tipo>('faturas');
  const [busca, setBusca] = React.useState('');
  const [dados, setDados] = React.useState<{ registros: Registro[]; total: number; contagem: Record<Tipo, number> } | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);

  const carregar = React.useCallback(async (signal?: AbortSignal) => {
    setEstado(e => (e === 'ok' ? 'ok' : 'carregando'));
    try {
      const q = new URLSearchParams({ tipo, ...(busca.trim() ? { busca: busca.trim() } : {}) });
      const r = await fetch(`/api/mudanca/historico?${q}`, { cache: 'no-store', signal });
      const corpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(corpo?.error ?? (r.status === 403 ? 'Só o administrador da agência vê os registros trazidos.' : 'Não deu para carregar agora.'));
      setDados(corpo);
      setEstado('ok');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setErro(e instanceof Error ? e.message : 'Não deu para carregar agora.');
      setEstado('erro');
    }
  }, [tipo, busca]);

  React.useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => { void carregar(c.signal); }, 250);
    return () => { clearTimeout(t); c.abort(); };
  }, [carregar]);

  const colunas: FinColuna<Registro>[] = [
    { id: 'data', cabecalho: tipo === 'comissoes_pagas' ? 'Pago em' : 'Data', tipo: 'texto', minWidth: 96, sortable: true, acessor: r => r.data ?? '', render: r => <span className="tabular-nums">{dataBR(r.data ?? '') || '—'}</span> },
    { id: 'numero', cabecalho: tipo === 'faturas' ? 'Fatura Nº' : tipo === 'notas' ? 'Nota Nº' : 'Venda Nº', tipo: 'texto', minWidth: 96, sortable: true, acessor: r => r.numero, render: r => <span className="tabular-nums text-[var(--fin-text)]">{r.numero || '—'}</span> },
    {
      id: 'pessoa', cabecalho: tipo === 'notas' ? 'Tomador' : tipo === 'comissoes_pagas' ? 'Quem recebeu' : 'Cliente', tipo: 'texto', minWidth: 200, sortable: true, acessor: r => r.pessoa,
      render: r => (
        <span className="flex flex-col">
          <span className="text-[var(--fin-text)]">{r.pessoa}</span>
          {txt(r.dados.situacao) ? <span className="fin-t-caption text-[var(--fin-text-3)]">{txt(r.dados.situacao)}</span> : null}
        </span>
      ),
    },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', valor: r => r.valor },
    {
      id: 'venda', cabecalho: 'Venda', tipo: 'texto', minWidth: 120,
      render: r => (r.venda_id ? <Link href={`/vendas/${r.venda_id}/ficha`} className="text-[var(--fin-accent)] underline-offset-2 hover:underline">Abrir a venda</Link> : <span className="fin-t-caption text-[var(--fin-text-3)]">—</span>),
    },
    { id: 'origem', cabecalho: 'Veio de', tipo: 'texto', minWidth: 180, render: r => <span className="fin-t-caption text-[var(--fin-text-2)]">{r.arquivo}{r.linha != null ? `, linha ${r.linha}` : ''}</span> },
  ];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Archive}
        titulo="Registros trazidos do sistema anterior"
        subtitulo="Faturas, notas emitidas e comissões já pagas, para consulta. Nada aqui cobra, emite ou paga de novo."
        acoesSecundarias={[{ rotulo: 'Mudar para o EnturOS', href: '/mudanca' }]}
      />
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        <Segmentado<Tipo>
          rotulo="Qual registro"
          valor={tipo}
          onChange={setTipo}
          cheio="celular"
          opcoes={(Object.keys(ROTULO) as Tipo[]).map(t => ({ valor: t, rotulo: ROTULO[t], contagem: dados?.contagem[t] }))}
        />
        <Callout tom="info" titulo={ROTULO[tipo]}>{FRASE[tipo]}</Callout>
        <FilterBar
          busca={{ valor: busca, onChange: setBusca, placeholder: 'Pesquisar número, pessoa…' }}
          resumo={{ exibidos: dados?.registros.length ?? 0, total: dados?.total ?? 0, substantivo: 'registros' }}
          ativos={busca ? 1 : 0}
          onLimpar={() => setBusca('')}
        />
        <DataState
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
          esqueleto={<div aria-hidden="true" className="h-64 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />}
        >
          <FinTable<Registro>
            linhas={dados?.registros ?? []}
            colunas={colunas}
            chave={r => r.id}
            densidade="compacta"
            estado="ok"
            vazio={busca
              ? { motivo: 'sem-resultado', titulo: 'Nada nesta busca', oQueE: 'Tente outro número ou nome.', acaoSecundaria: { rotulo: 'Limpar a busca', onClick: () => setBusca('') } }
              : { motivo: 'sem-dado', titulo: `Nenhum registro de ${ROTULO[tipo].toLowerCase()}`, oQueE: 'Eles chegam pelo assistente de mudança, no histórico do sistema anterior.' }}
          />
        </DataState>
      </div>
    </MolduraDaPagina>
  );
}
