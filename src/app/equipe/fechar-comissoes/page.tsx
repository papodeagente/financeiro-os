'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Callout } from '@/components/fin/Callout';
import { reais } from '@/components/comissoes/PainelDoVendedor';
import type { Funcao, ItemAFechar, LinhaDoFechamento } from '@/lib/comissao-funcoes';
import { frasesDaExplicacao } from '@/lib/comissao-funcoes';
import type { PreviaDoFechamento, ResultadoDoFechamento } from '@/lib/comissao-funcoes-servidor';
import { hojeISO } from '@/lib/money';
import { toast } from '@/lib/toast';

/**
 * Fechar comissões (E5, parte F): até uma data, por pessoa. A prévia mostra o
 * que entra (liberado − já fechado), com os estornos; quem tem erro (sem
 * plano, sem meta) aparece com o motivo e NÃO trava os outros. Fechar grava
 * só se os números ainda forem os da prévia.
 */

const CAMPO = 'h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 fin-t-body text-[var(--fin-text)] lg:h-10';
const pct = (p: number | null) => (p === null ? '—' : `${p.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

export default function FecharComissoesPage() {
  const [ate, setAte] = React.useState(hojeISO());
  const [funcaoId, setFuncaoId] = React.useState('');
  const [funcoes, setFuncoes] = React.useState<Funcao[]>([]);
  const [previa, setPrevia] = React.useState<PreviaDoFechamento | null>(null);
  const [estado, setEstado] = React.useState<'carregando' | 'ok' | 'erro'>('carregando');
  const [erro, setErro] = React.useState<string | null>(null);
  const [marcadas, setMarcadas] = React.useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = React.useState(false);
  const [fechando, setFechando] = React.useState(false);
  const [resultado, setResultado] = React.useState<ResultadoDoFechamento | null>(null);
  const [detalhe, setDetalhe] = React.useState<LinhaDoFechamento | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);

  const carregar = React.useCallback(async () => {
    setEstado('carregando');
    try {
      const q = new URLSearchParams({ ate, ...(funcaoId ? { funcao_id: funcaoId } : {}) });
      const r = await fetch(`/api/comissoes-por-funcao/previa?${q}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível calcular a prévia.');
      setPrevia(j);
      setMarcadas(new Set((j as PreviaDoFechamento).linhas.filter(l => !l.erros.length && l.itens.length).map(l => l.pessoa_funcao_id)));
      setEstado('ok');
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível calcular a prévia.');
      setEstado('erro');
    }
  }, [ate, funcaoId]);
  React.useEffect(() => { void carregar(); }, [carregar]);
  React.useEffect(() => {
    fetch('/api/comissoes-por-funcao/cadastro').then(r => (r.ok ? r.json() : null)).then(j => { if (j) setFuncoes(j.funcoes); }).catch(() => undefined);
  }, []);

  const linhas = previa?.linhas ?? [];
  const escolhidas = linhas.filter(l => marcadas.has(l.pessoa_funcao_id));
  const totalEscolhido = escolhidas.reduce((a, l) => a + l.saldo_centavos, 0);

  async function fechar() {
    if (!previa) return;
    setFechando(true);
    try {
      const r = await fetch('/api/comissoes-por-funcao/fechar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ate, participantes: [...marcadas], assinatura: previa.assinatura }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Não foi fechado.');
      setResultado(j);
      setConfirmar(false);
      toast.success('Comissões fechadas', `${j.fechados.length} ${j.fechados.length === 1 ? 'pessoa' : 'pessoas'} fechadas${j.recusados.length ? `, ${j.recusados.length} com pendência` : ''}.`);
      await carregar();
    } catch (e) {
      toast.error('Não foi fechado', e instanceof Error ? e.message : undefined);
      setConfirmar(false);
      await carregar();
    } finally {
      setFechando(false);
    }
  }

  const colunas: FinColuna<LinhaDoFechamento>[] = [
    { id: 'pessoa', cabecalho: 'Pessoa', tipo: 'texto', sortable: true, acessor: l => l.pessoa_nome, render: l => (
      <span className="flex flex-col">
        <span className="fin-t-body-strong text-[var(--fin-text)]">{l.pessoa_nome}</span>
        <span className="fin-t-caption text-[var(--fin-text-3)]">{l.funcao_nome}{l.plano_nome ? ` · ${l.plano_nome}` : ''}</span>
      </span>
    ) },
    { id: 'meta', cabecalho: 'Meta do mês', tipo: 'dinheiro', prioridade: 2, valor: l => (l.meta_centavos ?? 0) / 100, estado: l => (l.meta_centavos === null ? 'indisponivel' : 'ok'), sub: l => (l.percentual === null ? null : `${pct(l.percentual)} atingido`) },
    { id: 'valor', cabecalho: 'Comissão', tipo: 'dinheiro', valor: l => l.valor_centavos / 100 },
    { id: 'retido', cabecalho: 'Retido', tipo: 'dinheiro', prioridade: 1, valor: l => l.retido_centavos / 100 },
    { id: 'saldo', cabecalho: 'Saldo', tipo: 'dinheiro', sortable: true, valor: l => l.saldo_centavos / 100, tone: l => (l.saldo_centavos < 0 ? 'negativo' : 'neutro') },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'texto', minWidth: 200, render: l => (
      l.erros.length
        ? <span className="fin-t-caption text-[var(--fin-warning-text)]">{l.erros.join(' ')}</span>
        : l.meta_nao_atingida ? <span className="fin-t-caption text-[var(--fin-text-2)]">Meta não atingida</span>
          : <span className="fin-t-caption text-[var(--fin-text-2)]">{l.itens.length} {l.itens.length === 1 ? 'item' : 'itens'}{l.itens.some(i => i.estorno) ? ', com estorno' : ''}</span>
    ) },
  ];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={CalendarCheck}
        titulo="Fechar comissões"
        subtitulo="O que está liberado até a data, por pessoa. Quem tem pendência fica de fora; os outros fecham."
        atualizadoEm={atualizadoEm}
        onRecarregar={carregar}
        acoesSecundarias={[{ rotulo: 'Pagar comissões', href: '/equipe/pagar-comissoes' }, { rotulo: 'Funções e metas', href: '/equipe/funcoes' }]}
      />

      <div className="flex flex-wrap items-end gap-[var(--fin-s-3)]">
        <label className="flex flex-col gap-1">
          <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Fechar até</span>
          <input type="date" className={CAMPO} value={ate} onChange={e => setAte(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="fin-t-caption font-medium text-[var(--fin-text-2)]">Função</span>
          <select className={CAMPO} value={funcaoId} onChange={e => setFuncaoId(e.target.value)}>
            <option value="">Todas</option>
            {funcoes.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
      </div>

      <div className={RITMO_DA_PAGINA}>
        {previa && previa.regra !== 'FUNCOES' ? (
          <Callout tom="aviso" titulo="A agência usa o plano por vendedor">
            O fechamento por função começa quando a regra por função for escolhida em <Link className="underline underline-offset-4" href="/config/comissoes">Configurações › Comissões</Link>. Até lá, as comissões seguem na tela de <Link className="underline underline-offset-4" href="/equipe/comissoes">Comissões</Link>.
          </Callout>
        ) : null}
        {previa?.so_as_suas ? <Callout tom="info">Mostrando só as suas comissões.</Callout> : null}
        {previa && previa.vendas_abertas > 0 ? (
          <Callout tom="aviso">{previa.vendas_abertas} {previa.vendas_abertas === 1 ? 'venda ainda aberta não entra' : 'vendas ainda abertas não entram'} até esta data: só vendas fechadas geram comissão.</Callout>
        ) : null}
        {resultado && resultado.recusados.length ? (
          <Callout tom="aviso" titulo="Ficaram de fora">
            <ul className="flex flex-col gap-1">{resultado.recusados.map(r => <li key={r.pessoa_funcao_id}><strong>{r.pessoa_nome}</strong> ({r.funcao_nome}): {r.motivo}</li>)}</ul>
          </Callout>
        ) : null}

        <FinTable<LinhaDoFechamento>
          linhas={linhas}
          colunas={colunas}
          chave={l => l.pessoa_funcao_id}
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void carregar(); } } : null}
          vazio={{ motivo: 'sem-resultado', titulo: 'Nada a fechar até esta data', oQueE: 'Nenhuma comissão liberada e ainda não fechada, nem estorno pendente.' }}
          onLinhaClick={setDetalhe}
          selecao={{
            selecionadas: marcadas,
            onAlterar: (chaves, marcar) => setMarcadas(m => {
              const n = new Set(m);
              for (const k of chaves) {
                const l = linhas.find(x => x.pessoa_funcao_id === k);
                if (marcar && l && !l.erros.length && l.itens.length) n.add(k); else n.delete(k);
              }
              return n;
            }),
            rotulo: l => `Fechar a comissão de ${l.pessoa_nome}`,
          }}
          totais={[{ colunaId: 'saldo', valor: linhas.reduce((a, l) => a + l.saldo_centavos, 0) / 100, rotulo: 'Total' }]}
        />

        <div className="sticky bottom-0 z-[var(--fin-z-conteudo)] flex flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] bg-[var(--fin-bg)] py-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
          <p className="fin-t-body text-[var(--fin-text-2)]" aria-live="polite">
            {escolhidas.length} {escolhidas.length === 1 ? 'pessoa escolhida' : 'pessoas escolhidas'} · <span className="tabular-nums">{reais(totalEscolhido)}</span>
          </p>
          <Button type="button" onClick={() => setConfirmar(true)} disabled={!escolhidas.length || previa?.regra !== 'FUNCOES' || previa?.so_as_suas}>
            Fechar comissões
          </Button>
        </div>
      </div>

      <ConfirmDialog
        aberto={confirmar} onOpenChange={setConfirmar} processando={fechando}
        titulo={`Fechar as comissões até ${ate.split('-').reverse().join('/')}?`}
        oQueVaiAcontecer="Os valores liberados até a data ficam fechados e prontos para pagar. O que for liberado depois (ou estornado) entra no próximo fechamento."
        detalhes={[{ rotulo: 'Pessoas', valor: escolhidas.length }, { rotulo: 'Total', valor: reais(totalEscolhido) }]}
        confirmarRotulo="Fechar comissões" onConfirmar={fechar}
      />

      {detalhe ? (
        <RecordSheet
          aberto onOpenChange={o => { if (!o) setDetalhe(null); }} largura={640}
          titulo={`${detalhe.pessoa_nome} · ${detalhe.funcao_nome}`}
          descricao={detalhe.erros.length ? detalhe.erros.join(' ') : `${detalhe.itens.length} ${detalhe.itens.length === 1 ? 'item entra' : 'itens entram'} neste fechamento.`}
          resumo={`Saldo: ${reais(detalhe.saldo_centavos)}`}
          acaoPrimaria={{ rotulo: 'Fechar janela', onClick: () => setDetalhe(null) }}
          acaoSecundaria={null}
        >
          <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
            {detalhe.itens.map((i: ItemAFechar) => (
              <li key={i.chave} className="flex flex-col gap-[var(--fin-s-2)] py-[var(--fin-s-3)]">
                <div className="flex items-start justify-between gap-[var(--fin-s-3)]">
                  <Link href={`/vendas/${encodeURIComponent(i.venda_id)}/ficha`} className="fin-t-body-strong text-[var(--fin-text)] underline-offset-4 hover:underline">{i.venda_numero} · {i.descricao}</Link>
                  <span className={i.saldo_centavos < 0 ? 'fin-t-body-strong tabular-nums text-[var(--fin-negative-text)]' : 'fin-t-body-strong tabular-nums text-[var(--fin-text)]'}>{reais(i.saldo_centavos)}</span>
                </div>
                <ul className="flex flex-col gap-1 fin-t-caption text-[var(--fin-text-2)]">
                  {(i.explicacao ? frasesDaExplicacao(i.explicacao, i.comissao_centavos) : ['Esta venda não entra mais na comissão: o que já tinha sido fechado volta agora.']).map((f, k) => <li key={k}>{f}</li>)}
                  {i.estorno ? <li className="text-[var(--fin-negative-text)]">Estorno: entra negativo neste fechamento.</li> : null}
                </ul>
              </li>
            ))}
          </ul>
        </RecordSheet>
      ) : null}
    </MolduraDaPagina>
  );
}
