'use client';

import * as React from 'react';
import Link from 'next/link';
import { HandCoins } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { MoneyField } from '@/components/fin/MoneyField';
import { Callout } from '@/components/fin/Callout';
import { BotaoExportar } from '@/components/fin/BotaoExportar';
import { documentoDoPagamento } from '@/lib/exportacao/listas-financeiro';
import { reais } from '@/components/comissoes/PainelDoVendedor';
import type { PessoaAPagar, ResultadoDoPagamento } from '@/lib/comissao-funcoes-servidor';
import { toast } from '@/lib/toast';

/**
 * Pagar comissões (E5, parte F): o que foi fechado e ainda não foi pago, por
 * pessoa. Pagar o total (uma ou várias pessoas) ou uma parte (uma pessoa por
 * vez). Cada pessoa vira UMA conta a pagar com o detalhe das vendas; quem
 * ficou devendo depois dos estornos vira conta a receber.
 */
export default function PagarComissoesPage() {
  const [dados, setDados] = React.useState<{ regra: string; so_as_suas: boolean; pessoas: PessoaAPagar[] } | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [marcadas, setMarcadas] = React.useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = React.useState(false);
  const [parcial, setParcial] = React.useState<PessoaAPagar | null>(null);
  const [valorParcial, setValorParcial] = React.useState(0);
  const [processando, setProcessando] = React.useState(false);
  const [resultado, setResultado] = React.useState<ResultadoDoPagamento | null>(null);
  const [detalhe, setDetalhe] = React.useState<PessoaAPagar | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const r = await fetch('/api/comissoes-por-funcao/a-pagar');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível abrir.');
      setDados(j);
      setMarcadas(new Set());
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.');
      setEstado('erro');
    }
  }, []);
  React.useEffect(() => { void carregar(); }, [carregar]);

  const pessoas = dados?.pessoas ?? [];
  const escolhidas = pessoas.filter(p => marcadas.has(p.pessoa_id));
  const total = escolhidas.reduce((a, p) => a + p.aberto_centavos, 0);

  async function pagar(corpo: { modo: 'TOTAL' | 'PARCIAL'; pessoas: string[]; valor_centavos?: number }) {
    setProcessando(true);
    try {
      const r = await fetch('/api/comissoes-por-funcao/pagar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi pago.');
      setResultado(j);
      setConfirmar(false);
      setParcial(null);
      toast.success('Contas geradas', `${j.pagos.length} ${j.pagos.length === 1 ? 'conta' : 'contas'}, uma por pessoa. A baixa é em Contas a pagar.`);
      await carregar();
    } catch (e) {
      toast.error('Não foi pago', e instanceof Error ? e.message : undefined);
    } finally {
      setProcessando(false);
    }
  }

  const colunas: FinColuna<PessoaAPagar>[] = [
    { id: 'pessoa', cabecalho: 'Pessoa', tipo: 'texto', sortable: true, acessor: p => p.pessoa_nome, render: p => (
      <span className="flex flex-col">
        <span className="fin-t-body-strong text-[var(--fin-text)]">{p.pessoa_nome}</span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">{p.itens.length} {p.itens.length === 1 ? 'item fechado' : 'itens fechados'}{p.itens.some(i => i.estorno) ? ', com estorno' : ''}</span>
      </span>
    ) },
    { id: 'valor', cabecalho: 'Comissão', tipo: 'dinheiro', prioridade: 2, valor: p => p.itens.reduce((a, i) => a + i.valor_centavos, 0) / 100 },
    { id: 'retido', cabecalho: 'Retido', tipo: 'dinheiro', prioridade: 1, valor: p => p.itens.reduce((a, i) => a + i.retido_centavos, 0) / 100 },
    { id: 'aberto', cabecalho: 'A pagar', tipo: 'dinheiro', sortable: true, valor: p => p.aberto_centavos / 100, tone: p => (p.aberto_centavos < 0 ? 'negativo' : 'neutro'),
      sub: p => (p.aberto_centavos < 0 ? 'A pessoa deve à agência' : null) },
    { id: 'acoes', cabecalho: '', tipo: 'acoes', render: p => (
      <Button type="button" variant="ghost" size="sm" className="h-11 lg:h-8" disabled={p.aberto_centavos <= 0 || dados?.so_as_suas}
        onClick={e => { e.stopPropagation(); setValorParcial(0); setParcial(p); }}>
        Pagar parte
      </Button>
    ) },
  ];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={HandCoins}
        titulo="Pagar comissões"
        subtitulo="As comissões fechadas viram uma conta a pagar por pessoa, com o detalhe de cada venda."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
        acoesSecundarias={[{ rotulo: 'Fechar comissões', href: '/equipe/fechar-comissoes' }, { rotulo: 'Contas a pagar', href: '/financeiro-ag/pagar' }]}
      />
      <div className={RITMO_DA_PAGINA}>
        <div className="flex justify-end">
          <BotaoExportar origem="pagar_comissoes" desabilitado={!pessoas.length} documento={() => documentoDoPagamento(pessoas)} />
        </div>
        {dados?.so_as_suas ? <Callout tom="info">Mostrando só as suas comissões.</Callout> : null}
        {resultado && (resultado.pagos.length || resultado.recusados.length) ? (
          <Callout tom={resultado.recusados.length ? 'aviso' : 'positivo'} titulo="Último pagamento">
            <ul className="flex flex-col gap-1">
              {resultado.pagos.map(p => (
                <li key={p.pagamento_id}>
                  <strong>{p.pessoa_nome}</strong>: {p.conta_tabela === 'contas_pagar' ? `conta a pagar de ${reais(p.valor_centavos)}` : `conta a receber de ${reais(-p.valor_centavos)}`}, vence em {p.vencimento.split('-').reverse().join('/')}.{' '}
                  <Link className="underline underline-offset-4" href={p.conta_tabela === 'contas_pagar' ? '/financeiro-ag/pagar' : '/financeiro-ag/receber'}>Abrir</Link>
                </li>
              ))}
              {resultado.recusados.map(r => <li key={r.pessoa_id}><strong>{r.pessoa_nome}</strong>: {r.motivo}</li>)}
            </ul>
          </Callout>
        ) : null}

        <FinTable<PessoaAPagar>
          linhas={pessoas}
          colunas={colunas}
          chave={p => p.pessoa_id}
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
          vazio={{ motivo: 'sem-dado', titulo: 'Nenhuma comissão a pagar', oQueE: 'Feche as comissões até uma data para que elas apareçam aqui.', acao: { rotulo: 'Fechar comissões', href: '/equipe/fechar-comissoes' } }}
          onLinhaClick={setDetalhe}
          selecao={dados?.so_as_suas ? undefined : {
            selecionadas: marcadas,
            onAlterar: (chaves, marcar) => setMarcadas(m => { const n = new Set(m); for (const k of chaves) { if (marcar) n.add(k); else n.delete(k); } return n; }),
            rotulo: p => `Pagar a comissão de ${p.pessoa_nome}`,
          }}
          totais={[{ colunaId: 'aberto', valor: pessoas.reduce((a, p) => a + p.aberto_centavos, 0) / 100, rotulo: 'Total' }]}
        />

        {dados?.so_as_suas ? null : (
          <div className="sticky bottom-0 z-[var(--fin-z-conteudo)] flex flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] bg-[var(--fin-bg)] py-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
            <p className="fin-t-body text-[var(--fin-text-2)]" aria-live="polite">{escolhidas.length} {escolhidas.length === 1 ? 'pessoa' : 'pessoas'} · <span className="tabular-nums">{reais(total)}</span></p>
            <Button type="button" onClick={() => setConfirmar(true)} disabled={!escolhidas.length}>Pagar o total</Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        aberto={confirmar} onOpenChange={setConfirmar} processando={processando}
        titulo="Pagar o total das comissões fechadas?"
        oQueVaiAcontecer="Cada pessoa vira uma conta a pagar no próximo dia da agenda de comissões, com o detalhe das vendas. Quem ficou devendo vira conta a receber. A baixa é feita em Contas a pagar."
        detalhes={[{ rotulo: 'Pessoas', valor: escolhidas.length }, { rotulo: 'Total', valor: reais(total) }]}
        confirmarRotulo="Gerar as contas" onConfirmar={() => pagar({ modo: 'TOTAL', pessoas: [...marcadas] })}
      />

      {parcial ? (
        <RecordSheet
          aberto onOpenChange={o => { if (!o) setParcial(null); }} largura={480}
          titulo={`Pagar parte a ${parcial.pessoa_nome}`}
          descricao={`Em aberto: ${reais(parcial.aberto_centavos)}. O resto continua para o próximo pagamento.`}
          resumo={valorParcial > 0 ? `Gera uma conta a pagar de ${reais(Math.round(valorParcial * 100))}.` : 'Diga quanto pagar agora.'}
          acaoPrimaria={{ rotulo: 'Gerar a conta', carregando: processando, desabilitado: valorParcial <= 0 || Math.round(valorParcial * 100) > parcial.aberto_centavos,
            onClick: () => pagar({ modo: 'PARCIAL', pessoas: [parcial.pessoa_id], valor_centavos: Math.round(valorParcial * 100) }) }}
        >
          <MoneyField rotulo="Valor a pagar agora" valor={valorParcial} onChange={setValorParcial} maximo={parcial.aberto_centavos / 100} autoFocus
            atalhos={[{ rotulo: 'Metade', valor: Math.floor(parcial.aberto_centavos / 2) / 100 }, { rotulo: 'Tudo', valor: parcial.aberto_centavos / 100 }]} />
        </RecordSheet>
      ) : null}

      {detalhe ? (
        <RecordSheet
          aberto onOpenChange={o => { if (!o) setDetalhe(null); }} largura={640}
          titulo={detalhe.pessoa_nome} descricao="Itens fechados e ainda não pagos."
          resumo={`A pagar: ${reais(detalhe.aberto_centavos)}`}
          acaoPrimaria={{ rotulo: 'Fechar janela', onClick: () => setDetalhe(null) }} acaoSecundaria={null}
        >
          <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
            {detalhe.itens.map(i => (
              <li key={i.id} className="flex items-start justify-between gap-[var(--fin-s-3)] py-[var(--fin-s-2)]">
                <span className="flex min-w-0 flex-col">
                  <Link href={`/vendas/${encodeURIComponent(i.venda_id)}/ficha`} className="fin-t-body text-[var(--fin-text)] underline-offset-4 hover:underline">{i.venda_numero} · {i.descricao}</Link>
                  <span className="fin-t-caption text-[var(--fin-text-3)]">{i.funcao_nome}{i.pago_centavos ? ` · já pago ${reais(i.pago_centavos)}` : ''}{i.estorno ? ' · estorno' : ''}</span>
                </span>
                <span className={i.aberto_centavos < 0 ? 'fin-t-body-strong tabular-nums text-[var(--fin-negative-text)]' : 'fin-t-body-strong tabular-nums text-[var(--fin-text)]'}>{reais(i.aberto_centavos)}</span>
              </li>
            ))}
          </ul>
        </RecordSheet>
      ) : null}
    </MolduraDaPagina>
  );
}
