'use client';

/**
 * Recebimentos das plataformas (Hotmart, Asaas, Pagar.me).
 *
 * A tela responde, em cima, às perguntas que o Bruno faz do negócio:
 * quanto vendemos, quanto entrou, quanto falta entrar, quanto foi de taxa
 * e quanto voltou. Embaixo fica a fila: cada recebimento ou pertence a
 * uma venda do CRM, ou é uma venda direta — e as duas respostas são
 * legítimas. O que não pode existir é recebimento sem resposta.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lerAtalhos } from '@/lib/atalho-da-url';
import { ArrowDownLeft, Download, ExternalLink, Landmark, Link2, ListChecks, Percent, RotateCcw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataState } from '@/components/fin/DataState';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { PageHeader } from '@/components/fin/PageHeader';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { toast } from '@/lib/toast';
import { formatBRL, formatDate } from '@/lib/utils';
import { EtiquetaDaPlataforma } from '@/components/fin/EtiquetaDaPlataforma';
import { descreverPlano, planoDeUnificacao, type PlanoDeUnificacao } from '@/lib/plataformas/unificacao';
import { hojeISO } from '@/lib/money';

interface Item {
  plataforma: string;
  id_transacao: string;
  status_conciliacao: string;
  venda_id: string;
  venda_numero: string;
  comprador: string;
  documento: string;
  email: string;
  descricao: string;
  data_venda: string;
  bruto: number;
  taxa: number;
  liquido: number;
  recebido: number;
  a_receber: number;
  parcelas: number;
  parcelas_recebidas: number;
  proxima_previsao: string;
  conciliacao: { motivo?: string; candidatas?: Array<{ venda_id: string; pontos: number; confianca: string; motivos: string[] }> } | null;
  situacao?: { codigo: string; rotulo: string; conta_a_receber: boolean };
  parcelas_do_comprador?: number;
  avisos?: Array<{ quando: string; aviso: string; rotulo: string }>;
}

interface Revisao {
  executado_em: string;
  transacoes: number;
  corrigidas: number;
  nao_pagas: number;
  unificadas: number;
  duplicatas: number;
  contas_canceladas: number;
  puladas: Array<{ id_transacao: string; comprador: string; valor: number; motivo: string }>;
  erros: string[];
}

/** Tom da situação na plataforma: só "liberada" é verde; não pago é aviso. */
const TOM_SITUACAO: Record<string, string> = {
  liberada: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
  garantia: 'bg-[var(--fin-info-soft)] text-[var(--fin-info)]',
  aguardando: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
  'nao-paga': 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
  reembolsada: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]',
};

interface Resumo {
  vendido: number; recebido: number; a_receber: number; taxas: number;
  estornado: number; caixa: number; de_venda_crm: number; de_venda_direta: number;
  aguardando_conciliacao: number;
  por_plataforma: Array<{ plataforma: string; vendido: number; recebido: number; a_receber: number; taxas: number }>;
}

interface Candidato {
  venda_id: string;
  cliente_nome: string;
  valor_total: number;
  data_venda: string;
  pontuacao: { pontos: number; confianca: string; motivos: string[] };
  /** As contas a receber da própria venda: é o que a unificação substitui. */
  contas_da_venda?: Array<{ id: string; status: string; valor_final: number; data_vencimento: string }>;
}

const ROTULO_CONFIANCA: Record<string, string> = { ALTA: 'alta', MEDIA: 'média', BAIXA: 'baixa' };

/** O que dizer depois de unificar: números, não "sucesso". */
function resumoDaUnificacao(u: PlanoDeUnificacao | null | undefined): string {
  if (!u) return 'Recebimento unificado com a venda.';
  const canceladas = u.acoes.filter(a => a.acao === 'CANCELAR').length;
  const reduzidas = u.acoes.filter(a => a.acao === 'REDUZIR').length;
  const partes: string[] = [];
  if (canceladas > 0) partes.push(`${canceladas} ${canceladas === 1 ? 'conta substituída' : 'contas substituídas'}`);
  if (reduzidas > 0) partes.push(`${reduzidas} ${reduzidas === 1 ? 'reduzida' : 'reduzidas'}`);
  if (u.restante > 0) partes.push(`${formatBRL(u.restante)} ainda a receber`);
  if (u.excedente > 0) partes.push(`${formatBRL(u.excedente)} além do previsto na venda`);
  return partes.length > 0 ? `Recebimento unificado: ${partes.join(', ')}.` : 'Recebimento unificado: a venda não tinha conta pendente.';
}

const FILTROS: Array<{ id: string; rotulo: string }> = [
  { id: '', rotulo: 'Todos' },
  { id: 'SUGERIDA', rotulo: 'Sugestões a confirmar' },
  { id: 'PENDENTE', rotulo: 'Sem resposta' },
  { id: 'VINCULADA', rotulo: 'Vinculados a venda' },
  { id: 'DIRETA', rotulo: 'Vendas diretas' },
];

const ROTULO_STATUS: Record<string, string> = {
  VINCULADA: 'Venda do CRM',
  DIRETA: 'Venda direta',
  SUGERIDA: 'Sugestão a confirmar',
  PENDENTE: 'Sem resposta',
};

export default function RecebimentosPlataformasPage() {
  const [estado, setEstado] = useState<'carregando' | 'erro' | 'ok'>('carregando');
  const [erro, setErro] = useState('');
  const [itens, setItens] = useState<Item[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [filtro, setFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [de, setDe] = useState(`${hojeISO().slice(0, 8)}01`);
  const [ate, setAte] = useState(hojeISO());

  const [escolhendo, setEscolhendo] = useState<Item | null>(null);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [totalPlataforma, setTotalPlataforma] = useState(0);
  const [carregandoCandidatos, setCarregandoCandidatos] = useState(false);
  const [importando, setImportando] = useState('');
  const [revisao, setRevisao] = useState<Revisao | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [detalhe, setDetalhe] = useState<Item | null>(null);

  const carregar = useCallback(async () => {
    setEstado('carregando');
    try {
      const q = new URLSearchParams({ de, ate });
      if (filtro) q.set('status', filtro);
      if (busca.trim()) q.set('busca', busca.trim());
      const r = await fetch(`/api/plataformas/recebimentos?${q}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Não foi possível carregar.');
      setItens(j.itens ?? []);
      setResumo(j.resumo ?? null);
      setRevisao(j.revisao ?? null);
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
      setEstado('erro');
    }
  }, [de, ate, filtro, busca]);

  useEffect(() => { void carregar(); }, [carregar]);

  // A visão geral chega aqui com ?status=SUGERIDA ("pagamentos para ligar a uma venda").
  function aplicarAtalhos() {
    const status = lerAtalhos().get('status');
    if (status) setFiltro(status);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { aplicarAtalhos(); }, []);

  async function revisarHotmart() {
    if (revisando) return;
    setRevisando(true);
    try {
      const r = await fetch('/api/plataformas/recebimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'revisar_hotmart' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Não foi possível revisar.');
      const v = j.revisao as Revisao;
      toast.success(v.corrigidas > 0 ? `${v.corrigidas} recebimento(s) da Hotmart corrigido(s)` : 'Nada a corrigir nos recebimentos da Hotmart');
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    } finally {
      setRevisando(false);
    }
  }

  async function agir(item: Item, acao: 'vincular' | 'direta', vendaId = '') {
    try {
      const r = await fetch('/api/plataformas/recebimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao, plataforma: item.plataforma, id_transacao: item.id_transacao, venda_id: vendaId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Não foi possível concluir.');
      toast.success(acao === 'vincular'
        ? resumoDaUnificacao(j.unificacao)
        : j.restauradas > 0
          ? `Registrado como venda direta. ${j.restauradas} ${j.restauradas === 1 ? 'conta da venda voltou' : 'contas da venda voltaram'} ao que era.`
          : 'Registrado como venda direta.');
      setEscolhendo(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  async function abrirEscolha(item: Item) {
    setEscolhendo(item);
    setCandidatos([]);
    setCarregandoCandidatos(true);
    try {
      const q = new URLSearchParams({ candidatos_de: item.id_transacao, plataforma: item.plataforma });
      const r = await fetch(`/api/plataformas/recebimentos?${q}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Não foi possível buscar as vendas.');
      setCandidatos(j.candidatos ?? []);
      setTotalPlataforma(Number(j.total_plataforma ?? item.bruto ?? 0));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    } finally {
      setCarregandoCandidatos(false);
    }
  }

  async function importar(plataforma: string) {
    setImportando(plataforma);
    try {
      const r = await fetch('/api/plataformas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'importar', plataforma, de, ate }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'A importação falhou.');
      const i = j.importacao;
      toast.success(`${i.encontradas} transação(ões): ${i.novas} nova(s), ${i.atualizadas} atualizada(s).`);
      if (i.erros?.length) toast.error(`${i.erros.length} precisam de conferência manual.`);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    } finally {
      setImportando('');
    }
  }

  const colunas: FinColuna<Item>[] = useMemo(() => [
    {
      id: 'comprador', cabecalho: 'Comprador', tipo: 'texto', minWidth: 220,
      render: r => (
        <div>
          <div className="font-medium">{r.comprador || r.email || 'Sem nome'}</div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-[var(--fin-text-muted)]">
            <EtiquetaDaPlataforma plataforma={r.plataforma} />
            <span className="min-w-0 truncate">{r.descricao}</span>
          </div>
        </div>
      ),
      acessor: r => r.comprador,
    },
    {
      id: 'situacao', cabecalho: 'Na plataforma', tipo: 'texto', minWidth: 200,
      acessor: r => r.situacao?.rotulo ?? '',
      render: r => r.situacao ? (
        <span className={`inline-flex rounded-[var(--fin-r-sm)] px-2 py-0.5 text-xs font-medium ${TOM_SITUACAO[r.situacao.codigo] ?? 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]'}`}>
          {r.situacao.rotulo}
        </span>
      ) : null,
    },
    {
      id: 'status', cabecalho: 'Conciliação', tipo: 'texto', minWidth: 170, prioridade: 2,
      render: r => (
        <div>
          <div>{ROTULO_STATUS[r.status_conciliacao] ?? r.status_conciliacao}</div>
          {r.venda_numero && <div className="text-xs text-[var(--fin-text-muted)]">Venda {r.venda_numero}</div>}
          {r.status_conciliacao === 'SUGERIDA' && r.conciliacao?.motivo && (
            <div className="text-xs text-[var(--fin-text-muted)]">{r.conciliacao.motivo}</div>
          )}
        </div>
      ),
      acessor: r => r.status_conciliacao,
    },
    {
      id: 'bruto', cabecalho: 'Venda', tipo: 'dinheiro', valor: r => r.bruto,
      sub: r => (r.parcelas > 1
        ? `${r.parcelas_recebidas}/${r.parcelas} parcelas`
        : (r.parcelas_do_comprador ?? 1) > 1 ? `${r.parcelas_do_comprador}x no cartão do comprador` : null),
    },
    {
      id: 'taxa', cabecalho: 'Taxa', tipo: 'dinheiro', valor: r => r.taxa, prioridade: 1,
      tone: () => 'negativo',
    },
    { id: 'recebido', cabecalho: 'Recebido', tipo: 'dinheiro', valor: r => r.recebido, tone: () => 'positivo' },
    {
      id: 'a_receber', cabecalho: 'A receber', tipo: 'dinheiro', valor: r => r.a_receber, prioridade: 2,
      sub: r => (r.proxima_previsao ? `previsto ${formatDate(r.proxima_previsao)}` : null),
    },
    {
      id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: r => (
        <div className="flex gap-1 justify-end">
          <Button size="sm" variant="ghost" onClick={() => void abrirEscolha(r)} title="Unificar com uma venda do CRM">
            <Link2 className="h-4 w-4" />
          </Button>
          {r.status_conciliacao !== 'DIRETA' && (
            <Button size="sm" variant="ghost" onClick={() => void agir(r, 'direta')} title="Registrar como venda direta (desfaz a unificação, se houver)">
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ], []);

  return (
    <MolduraDaPagina>
      <PageHeader
        titulo="Recebimentos das plataformas"
        subtitulo="Hotmart, Asaas e Pagar.me: o que foi vendido, o que já entrou e o que ainda falta entrar."
        onRecarregar={carregar}
      />

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block text-xs text-[var(--fin-text-muted)]">De</span>
          <Input type="date" value={de} onChange={e => setDe(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-[var(--fin-text-muted)]">Até</span>
          <Input type="date" value={ate} onChange={e => setAte(e.target.value)} />
        </label>
        <div className="flex-1 min-w-[200px]">
          <span className="block text-xs text-[var(--fin-text-muted)]">Buscar</span>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--fin-text-muted)]" />
            <Input
              className="pl-8"
              placeholder="Nome, e-mail ou id da transação"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void carregar(); }}
            />
          </div>
        </div>
        {['asaas', 'pagarme'].map(p => (
          <Button key={p} variant="outline" size="sm" disabled={importando === p} onClick={() => void importar(p)}>
            <Download className="h-4 w-4 mr-1" />
            {importando === p ? 'Importando…' : `Importar ${p}`}
          </Button>
        ))}
      </div>

      {resumo && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            rotulo="Vendemos" icone={ArrowDownLeft} valor={resumo.vendido} estado="ok" emphasis="destaque"
            contexto={`no período de ${formatDate(de)} a ${formatDate(ate)}, sem o que foi estornado`}
          />
          <MetricCard
            rotulo="Entrou no caixa" icone={Landmark} valor={resumo.caixa} estado="ok" tone="positivo"
            contexto="líquido das parcelas que a plataforma já liberou"
          />
          <MetricCard
            rotulo="Ainda a receber" icone={ArrowDownLeft} valor={resumo.a_receber} estado="ok"
            contexto="parcelas pagas e não liberadas, mais as que ainda vão vencer"
          />
          <MetricCard
            rotulo="Taxas das plataformas" icone={Percent} valor={resumo.taxas} estado="ok" tone="negativo"
            contexto="o que a plataforma reteve sobre as vendas do período"
          />
          <MetricCard
            rotulo="Estornado e chargeback" icone={RotateCcw} valor={resumo.estornado} estado="ok" tone="negativo"
            contexto="dinheiro que voltou e saiu da receita"
          />
          <MetricCard
            rotulo="Sem resposta de conciliação" icone={ListChecks} valor={resumo.aguardando_conciliacao} estado="ok"
            contexto={`${resumo.de_venda_crm > 0 ? 'de venda do CRM: ' : ''}${resumo.de_venda_crm.toFixed(2)} · venda direta: ${resumo.de_venda_direta.toFixed(2)}`}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {FILTROS.map(f => (
          <Button
            key={f.id || 'todos'}
            size="sm"
            variant={filtro === f.id ? 'default' : 'ghost'}
            onClick={() => setFiltro(f.id)}
          >
            {f.rotulo}
          </Button>
        ))}
      </div>

      {revisao && (revisao.corrigidas > 0 || revisao.puladas.length > 0) && (
        <section className="flex flex-col gap-2 rounded-[var(--fin-r-lg)] border border-[var(--fin-info)]/30 bg-[var(--fin-info-soft)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="fin-t-body-strong text-[var(--fin-text)]">
                Revisão dos recebimentos da Hotmart ({formatDate(revisao.executado_em.slice(0, 10))})
              </h2>
              <p className="fin-t-caption text-[var(--fin-text-2)]">
                {(() => {
                  const n = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;
                  const partes = [
                    revisao.nao_pagas > 0 && `${n(revisao.nao_pagas, 'cobrança gerada e não paga saiu', 'cobranças geradas e não pagas saíram')} de Contas a receber`,
                    revisao.unificadas > 0 && `${n(revisao.unificadas, 'venda parcelada virou um recebimento', 'vendas parceladas viraram um recebimento cada')} (a Hotmart repassa a venda inteira)`,
                    revisao.duplicatas > 0 && `${n(revisao.duplicatas, 'conta duplicada da versão antiga foi cancelada', 'contas duplicadas da versão antiga foram canceladas')}`,
                  ].filter(Boolean) as string[];
                  const frase = partes.length > 0 ? `${partes.join('; ')}.` : 'Nenhuma correção foi necessária.';
                  const pulo = revisao.puladas.length > 0
                    ? ` ${n(revisao.puladas.length, 'venda não foi alterada', 'vendas não foram alteradas')} porque alguém já tinha mexido; confira abaixo.`
                    : '';
                  return frase + pulo;
                })()}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={revisando} onClick={() => void revisarHotmart()}>
              {revisando ? 'Revisando…' : 'Revisar de novo'}
            </Button>
          </div>
          {revisao.puladas.length > 0 && (
            <ul className="flex flex-col gap-1">
              {revisao.puladas.slice(0, 8).map(p => (
                <li key={p.id_transacao} className="fin-t-caption text-[var(--fin-text-2)]">
                  {p.comprador || p.id_transacao} ({formatBRL(p.valor)}): {p.motivo.split(': ').pop()}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <FinTable
        linhas={itens}
        colunas={colunas}
        onLinhaClick={r => setDetalhe(r)}
        chave={r => `${r.plataforma}:${r.id_transacao}`}
        estado={estado}
        erro={estado === 'erro' ? { mensagem: erro, onTentarDeNovo: () => void carregar() } : null}
        vazio={{
          motivo: filtro || busca ? 'sem-resultado' : 'sem-dado',
          titulo: 'Nenhum recebimento neste recorte',
          oQueE: 'Aqui aparece cada venda feita pela Hotmart, pelo Asaas ou pelo Pagar.me, com as parcelas, a taxa e o que já caiu na conta.',
          comoComeca: filtro || busca ? undefined : [
            'Cadastre a credencial da plataforma em Configurações, Plataformas de venda.',
            'Cole a URL do webhook no painel da plataforma.',
            'Use o botão Importar para trazer o histórico que já existe lá.',
          ],
        }}
      />

      {escolhendo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEscolhendo(null)}>
          <div className="w-full max-w-2xl rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-5 shadow-[var(--fin-e-card)]" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Unificar com uma venda do CRM</h2>
            <p className="text-sm text-[var(--fin-text-muted)] mt-1">
              {escolhendo.comprador || escolhendo.email} · <Money valor={escolhendo.bruto} estado="ok" /> ·{' '}
              {escolhendo.data_venda ? formatDate(escolhendo.data_venda) : 'sem data'}
            </p>
            <p className="text-sm text-[var(--fin-text-muted)] mt-2">
              Este recebimento passa a ser o recebimento da venda: as contas pendentes que ele cobre
              são substituídas e o que faltar continua a receber. Nada que já foi recebido muda, e
              &ldquo;É venda direta&rdquo; desfaz.
            </p>

            <div className="mt-4 max-h-[50vh] overflow-auto">
              <DataState
                estado={carregandoCandidatos ? 'carregando' : 'ok'}
                esqueleto={
                  <ul className="space-y-2" aria-hidden>
                    {[0, 1, 2].map(i => (
                      <li key={i} className="h-[62px] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)]" />
                    ))}
                  </ul>
                }
              >
                {candidatos.length === 0 ? (
                  <p className="text-sm text-[var(--fin-text-muted)] py-6">
                    Nenhuma venda do CRM parecida no período. Se este dinheiro não veio de uma negociação,
                    registre como venda direta.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {candidatos.map(c => {
                      const plano = planoDeUnificacao(c.contas_da_venda ?? [], totalPlataforma);
                      return (
                        <li key={c.venda_id} className="flex items-center justify-between gap-3 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-3">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{c.cliente_nome || 'Sem cliente'}</div>
                            <div className="text-xs text-[var(--fin-text-muted)]">
                              {c.data_venda ? formatDate(c.data_venda) : 'sem data'} · confiança {ROTULO_CONFIANCA[c.pontuacao.confianca] ?? c.pontuacao.confianca.toLowerCase()}
                              {c.pontuacao.motivos.length > 0 && ` · ${c.pontuacao.motivos.join(', ')}`}
                            </div>
                            <div className="text-xs mt-1 text-[var(--fin-text-2)]">
                              {descreverPlano(plano, totalPlataforma, formatBRL)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Money valor={c.valor_total} estado="ok" />
                            <Button size="sm" onClick={() => void agir(escolhendo, 'vincular', c.venda_id)}>Unificar</Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </DataState>
            </div>

            <div className="mt-4 flex justify-between gap-2">
              <Button variant="outline" onClick={() => void agir(escolhendo, 'direta')}>
                É venda direta
              </Button>
              <Button variant="ghost" onClick={() => setEscolhendo(null)}>Fechar</Button>
            </div>
          </div>
        </div>
      )}
      <RecordSheet
        aberto={detalhe !== null}
        onOpenChange={aberto => { if (!aberto) setDetalhe(null); }}
        titulo={detalhe ? (detalhe.comprador || detalhe.email || 'Recebimento') : 'Recebimento'}
        descricao={detalhe ? `${detalhe.descricao} · transação ${detalhe.id_transacao}` : undefined}
        acaoPrimaria={detalhe && detalhe.situacao?.conta_a_receber
          ? { rotulo: 'Unificar com uma venda do CRM', onClick: () => { const d = detalhe; setDetalhe(null); void abrirEscolha(d); } }
          : { rotulo: 'Fechar', onClick: () => setDetalhe(null) }}
        acaoSecundaria={detalhe && detalhe.situacao?.conta_a_receber ? undefined : null}
      >
        {detalhe && (
          <div className="flex flex-col gap-[var(--fin-s-4)]">
            <div className="flex flex-wrap items-center gap-2">
              <EtiquetaDaPlataforma plataforma={detalhe.plataforma} />
              {detalhe.situacao && (
                <span className={`inline-flex rounded-[var(--fin-r-sm)] px-2 py-0.5 text-xs font-medium ${TOM_SITUACAO[detalhe.situacao.codigo] ?? 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]'}`}>
                  {detalhe.situacao.rotulo}
                </span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-3 sm:grid-cols-4">
              <div><dt className="fin-t-overline text-[var(--fin-text-3)]">Valor</dt><dd><Money valor={detalhe.bruto} size="strong" estado="ok" align="esquerda" className="min-w-0" /></dd></div>
              <div><dt className="fin-t-overline text-[var(--fin-text-3)]">Taxa</dt><dd><Money valor={detalhe.taxa} size="strong" estado="ok" align="esquerda" className="min-w-0" /></dd></div>
              <div><dt className="fin-t-overline text-[var(--fin-text-3)]">Recebido</dt><dd><Money valor={detalhe.recebido} size="strong" estado="ok" align="esquerda" className="min-w-0" /></dd></div>
              <div><dt className="fin-t-overline text-[var(--fin-text-3)]">A receber</dt><dd><Money valor={detalhe.a_receber} size="strong" estado="ok" align="esquerda" className="min-w-0" /></dd></div>
            </dl>
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              {detalhe.data_venda ? `Compra em ${formatDate(detalhe.data_venda)}. ` : ''}
              {(detalhe.parcelas_do_comprador ?? 1) > 1 ? `O comprador parcelou em ${detalhe.parcelas_do_comprador}x no cartão; a Hotmart repassa a venda inteira. ` : ''}
              {detalhe.proxima_previsao && detalhe.a_receber > 0 ? `Liberação prevista em ${formatDate(detalhe.proxima_previsao)}.` : ''}
            </p>
            <section className="flex flex-col gap-2">
              <h3 className="fin-t-overline text-[var(--fin-text-3)]">Avisos recebidos da plataforma</h3>
              {(detalhe.avisos ?? []).length === 0 ? (
                <p className="fin-t-caption text-[var(--fin-text-3)]">Nenhum aviso registrado para esta transação (pode ter vindo pela importação).</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {(detalhe.avisos ?? []).map((a, i) => (
                    <li key={i} className="flex items-start gap-3 rounded-[var(--fin-r-sm)] px-2 py-1.5 odd:bg-[var(--fin-surface-2)]">
                      <span className="fin-t-caption w-[116px] shrink-0 tabular-nums text-[var(--fin-text-3)]">
                        {a.quando ? new Date(a.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                      <span className="fin-t-body min-w-0 text-[var(--fin-text)]">{a.rotulo}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </RecordSheet>
    </MolduraDaPagina>
  );
}
