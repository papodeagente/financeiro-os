'use client';

import * as React from 'react';
import { Wallet } from 'lucide-react';

import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { SeletorDeMes, useMesDaUrl } from '@/components/fin/SeletorDeMes';
import { PainelDoVendedorView } from '@/components/comissoes/PainelDoVendedor';
import type { PainelDoVendedor } from '@/lib/comissao-funcoes-servidor';

/**
 * Minhas comissões (E5, parte F): o painel do vendedor, para o celular. Cada
 * pessoa vê a própria comissão do mês, a meta, quanto falta para a próxima
 * faixa e a conta aberta de cada venda.
 */
export default function MinhasComissoesPage() {
  const [mes, setMes] = useMesDaUrl();
  const [painel, setPainel] = React.useState<PainelDoVendedor | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch(`/api/comissoes-por-funcao/painel?mes=${encodeURIComponent(mes)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir.');
      setPainel(j);
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, [mes]);
  React.useEffect(() => { void carregar(); }, [carregar]);

  return (
    <MolduraDaPagina className="max-w-2xl">
      <PageHeader icone={Wallet} titulo="Minhas comissões" subtitulo="O que você tem a receber, venda a venda, e quanto falta para a próxima faixa." atualizadoEm={atualizadoEm} onRecarregar={carregar} />
      <SeletorDeMes valor={mes} onChange={setMes} />
      <DataState
        className={RITMO_DA_PAGINA}
        estado={estado}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
        esqueleto={<div className="flex flex-col gap-[var(--fin-s-4)]"><div className="h-40 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" /><div className="h-64 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" /></div>}
      >
        {painel && painel.regra !== 'FUNCOES' ? (
          <EmptyLesson
            motivo="sem-dado"
            titulo="Sua agência usa a tela de Comissões"
            oQueE="A comissão da sua agência é calculada pela regra de antes. Você encontra o que tem a receber em Comissões."
            acao={{ rotulo: 'Abrir Comissões', href: '/equipe/comissoes' }}
          />
        ) : painel && !painel.resumos.length && !painel.itens.length ? (
          <EmptyLesson
            motivo="sem-resultado"
            titulo="Nada de comissão neste mês"
            oQueE="Você não está numa função com plano de comissão ou não houve venda sua neste mês."
            comoComeca={['Peça ao financeiro para incluir você numa função, com plano e meta', 'As vendas do mês aparecem aqui no dia seguinte, ou na hora em que o financeiro recalcular']}
          />
        ) : painel ? <PainelDoVendedorView painel={painel} /> : null}
      </DataState>
    </MolduraDaPagina>
  );
}
