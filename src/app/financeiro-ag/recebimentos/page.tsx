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
import { Link2, Download, ExternalLink, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataState } from '@/components/fin/DataState';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { PageHeader } from '@/components/fin/PageHeader';
import { PageShell } from '@/components/fin/PageShell';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/utils';
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
}

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
  const [carregandoCandidatos, setCarregandoCandidatos] = useState(false);
  const [importando, setImportando] = useState('');

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
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
      setEstado('erro');
    }
  }, [de, ate, filtro, busca]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function agir(item: Item, acao: 'vincular' | 'direta', vendaId = '') {
    try {
      const r = await fetch('/api/plataformas/recebimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao, plataforma: item.plataforma, id_transacao: item.id_transacao, venda_id: vendaId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Não foi possível concluir.');
      toast.success(acao === 'vincular' ? 'Recebimento vinculado à venda.' : 'Registrado como venda direta.');
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
          <div className="text-xs text-[var(--fin-text-muted)]">
            {r.descricao} · {r.plataforma}
          </div>
        </div>
      ),
      acessor: r => r.comprador,
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
      sub: r => (r.parcelas > 1 ? `${r.parcelas_recebidas}/${r.parcelas} parcelas` : null),
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
          <Button size="sm" variant="ghost" onClick={() => void abrirEscolha(r)} title="Vincular a uma venda do CRM">
            <Link2 className="h-4 w-4" />
          </Button>
          {r.status_conciliacao !== 'DIRETA' && (
            <Button size="sm" variant="ghost" onClick={() => void agir(r, 'direta')} title="Registrar como venda direta">
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ], []);

  return (
    <PageShell>
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
            rotulo="Vendemos" valor={resumo.vendido} estado="ok" emphasis="destaque"
            contexto={`no período de ${formatDate(de)} a ${formatDate(ate)}, sem o que foi estornado`}
          />
          <MetricCard
            rotulo="Entrou no caixa" valor={resumo.caixa} estado="ok" tone="positivo"
            contexto="líquido das parcelas que a plataforma já liberou"
          />
          <MetricCard
            rotulo="Ainda a receber" valor={resumo.a_receber} estado="ok"
            contexto="parcelas pagas e não liberadas, mais as que ainda vão vencer"
          />
          <MetricCard
            rotulo="Taxas das plataformas" valor={resumo.taxas} estado="ok" tone="negativo"
            contexto="o que a plataforma reteve sobre as vendas do período"
          />
          <MetricCard
            rotulo="Estornado e chargeback" valor={resumo.estornado} estado="ok" tone="negativo"
            contexto="dinheiro que voltou e saiu da receita"
          />
          <MetricCard
            rotulo="Sem resposta de conciliação" valor={resumo.aguardando_conciliacao} estado="ok"
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

      <FinTable
        linhas={itens}
        colunas={colunas}
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
          <div className="w-full max-w-2xl rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Vincular a uma venda do CRM</h2>
            <p className="text-sm text-[var(--fin-text-muted)] mt-1">
              {escolhendo.comprador || escolhendo.email} · <Money valor={escolhendo.bruto} estado="ok" /> ·{' '}
              {escolhendo.data_venda ? formatDate(escolhendo.data_venda) : 'sem data'}
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
                    {candidatos.map(c => (
                      <li key={c.venda_id} className="flex items-center justify-between gap-3 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{c.cliente_nome || 'Sem cliente'}</div>
                          <div className="text-xs text-[var(--fin-text-muted)]">
                            {c.data_venda ? formatDate(c.data_venda) : 'sem data'} · confiança {c.pontuacao.confianca.toLowerCase()}
                            {c.pontuacao.motivos.length > 0 && ` · ${c.pontuacao.motivos.join(', ')}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Money valor={c.valor_total} estado="ok" />
                          <Button size="sm" onClick={() => void agir(escolhendo, 'vincular', c.venda_id)}>Vincular</Button>
                        </div>
                      </li>
                    ))}
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
    </PageShell>
  );
}
