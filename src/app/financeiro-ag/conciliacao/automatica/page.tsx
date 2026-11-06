'use client';

/**
 * Conciliação automática (E6, 05/11/2026).
 *
 * O sistema aprende com cada conciliação feita na fila: a mesma descrição
 * do banco (ou o mesmo CNPJ) vira uma regra. A regra SUGERE; só concilia
 * sozinha quando a agência liga e ela tem certeza (três vezes do mesmo
 * jeito, nunca desfeita), e só com a MESMA pessoa e o MESMO valor. Tudo o
 * que foi conciliado sozinho fica numa lista, com desfazer. Tarifa de banco
 * que se repete todo mês vira sugestão de conta a pagar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, CheckCircle2, Landmark, Power, Receipt, Sparkles, Trash2, Undo2, Wand2 } from 'lucide-react';

import type { ContaBancaria, PlanoContas } from '@/lib/crm-types';
import type { Decisao, NivelDeCerteza, RegraDeConciliacao, TarifaRecorrente } from '@/lib/conciliacao-regras';
import { loadEntities } from '@/lib/crm-storage';
import { formatBRL, formatDate, cn } from '@/lib/utils';
import { toast } from '@/lib/toast';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Callout } from '@/components/fin/Callout';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { StatusChip } from '@/components/fin/StatusChip';

interface Sugestao {
  extrato_id: string;
  conta_bancaria_id: string;
  data: string;
  valor: number;
  descricao: string;
  decisao: Decisao;
}
interface Automatica {
  id: string;
  extrato_id: string;
  conta_bancaria_id: string;
  data_extrato: string;
  descricao: string;
  valor: number;
  pessoa_nome: string;
  executada_em: string;
  executada_por_nome: string | null;
  desfeita_em: string | null;
  desfeita_por: string | null;
  criou_conta: boolean;
}
type Regra = RegraDeConciliacao & { exemplo: string; ultima_em: string | null; certeza: { nivel: NivelDeCerteza; texto: string } };
type Tarifa = TarifaRecorrente & { conta_criada_id: string | null };
interface Dados { regras: Regra[]; sugestoes: Sugestao[]; automaticas: Automatica[]; tarifas: Tarifa[] }

type Aba = 'sugestoes' | 'sozinha' | 'regras' | 'tarifas';

const FOCO = 'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';
const BOTAO_LINHA = cn(
  'fin-t-body h-10 max-lg:h-11 gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-3 shadow-none',
  'border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
  FOCO,
);
const BOTAO_DISCRETO = cn(
  'fin-t-caption h-9 gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-2 shadow-none',
  'bg-transparent text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
  FOCO,
);
const CONTROLE = cn(
  'fin-t-body h-11 min-h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10 lg:min-h-10',
  FOCO,
);

const fmtCent = (c: number) => formatBRL(c / 100);
/** Data e hora de Brasília a partir do texto do Postgres ("2026-11-05 14:00:00.1+00"). */
function quando(texto: string): string {
  const iso = texto.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return texto.slice(0, 16);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d);
}
const SEM_CATEGORIA = '__sem_categoria__';

async function postar<T>(url: string, corpo: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || 'Não foi possível concluir.');
  return j as T;
}

export default function ConciliacaoAutomaticaPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [categorias, setCategorias] = useState<PlanoContas[]>([]);
  const [aba, setAba] = useState<Aba>('sugestoes');
  const [executando, setExecutando] = useState(false);
  const [aplicando, setAplicando] = useState<Sugestao | null>(null);
  const [desfazendo, setDesfazendo] = useState<Automatica | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [tarifa, setTarifa] = useState<Tarifa | null>(null);
  const [tarifaBanco, setTarifaBanco] = useState('');
  const [tarifaCategoria, setTarifaCategoria] = useState('');
  const [excluindo, setExcluindo] = useState<Regra | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch('/api/conciliacao/automatica');
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || 'Não foi possível carregar.');
      setDados(j as Dados);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
    }
  }, []);

  useEffect(() => {
    void carregar();
    void loadEntities<ContaBancaria>('contas-bancarias').then(setContas).catch(() => {});
    void loadEntities<PlanoContas>('plano-contas').then(setCategorias).catch(() => {});
  }, [carregar]);

  const nomeDaConta = useCallback((id: string) => contas.find(c => c.id === id)?.nome || (id ? 'Conta bancária' : 'Qualquer conta'), [contas]);
  const sugestoes = useMemo(() => (dados?.sugestoes ?? []).filter(s => s.decisao.tipo !== 'nada'), [dados]);
  const semConta = (dados?.sugestoes ?? []).length - sugestoes.length;
  const prontas = sugestoes.filter(s => s.decisao.tipo === 'sozinha').length;
  const ativas = (dados?.automaticas ?? []).filter(a => !a.desfeita_em);
  const ligadas = (dados?.regras ?? []).filter(r => r.auto_ligada).length;
  const tarifasNovas = (dados?.tarifas ?? []).filter(t => !t.conta_criada_id);
  const despesas = categorias.filter(c => c.tipo !== 'RECEITA' && c.ativo !== false);

  async function executar() {
    setExecutando(true);
    try {
      const r = await postar<{ conciliadas: unknown[]; puladas: { motivo: string }[] }>('/api/conciliacao/automatica', { acao: 'executar' });
      if (r.conciliadas.length === 0 && r.puladas.length === 0) toast.info('Nada para conciliar sozinho agora', 'As linhas com regra ligada já estão conferidas.');
      else toast.success(
        r.conciliadas.length === 1 ? '1 linha conciliada sozinha' : `${r.conciliadas.length} linhas conciliadas sozinhas`,
        r.puladas.length ? `${r.puladas.length} ficaram na fila: ${r.puladas[0].motivo}` : 'Confira na lista Conciliado sozinho. Tudo pode ser desfeito.',
      );
      await carregar();
      if (r.conciliadas.length > 0) setAba('sozinha');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível conciliar.');
    } finally {
      setExecutando(false);
    }
  }

  async function aplicarSugestao() {
    if (!aplicando || ocupado) return;
    const d = aplicando.decisao;
    if (d.tipo === 'nada') return;
    setOcupado(true);
    try {
      const corpo = d.titulo
        ? { acao: 'vincular', extrato_id: aplicando.extrato_id, contas: [{ tipo: d.titulo.tabela === 'contas_receber' ? 'CONTA_RECEBER' : 'CONTA_PAGAR', id: d.titulo.id }] }
        : { acao: 'criar', extrato_id: aplicando.extrato_id, nome: d.regra.pessoa_nome, descricao: aplicando.descricao, categoria_id: d.regra.categoria_id || undefined };
      await postar('/api/conciliacao/conciliar', corpo);
      toast.success('Linha conciliada', 'A regra ganhou mais uma confirmação.');
      setAplicando(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível conciliar.');
    } finally {
      setOcupado(false);
    }
  }

  async function desfazer() {
    if (!desfazendo || ocupado) return;
    setOcupado(true);
    try {
      await postar('/api/conciliacao/conciliar', { acao: 'desfazer', extrato_id: desfazendo.extrato_id, motivo: 'Desfeita na lista de conciliação automática' });
      toast.success('Conciliação desfeita', 'A baixa foi estornada, a linha voltou para a fila e a regra parou de conciliar sozinha.');
      setDesfazendo(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível desfazer.');
    } finally {
      setOcupado(false);
    }
  }

  async function ligar(regra: Regra, ligarAgora: boolean) {
    try {
      await postar('/api/conciliacao/automatica', { acao: 'ligar', regra_id: regra.id, ligar: ligarAgora });
      toast.success(ligarAgora ? 'Regra ligada' : 'Regra desligada', ligarAgora ? 'Linhas iguais passam a ser conciliadas sozinhas, com desfazer.' : 'Ela volta a só sugerir.');
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível mudar a regra.');
    }
  }

  async function excluirRegra() {
    if (!excluindo || ocupado) return;
    setOcupado(true);
    try {
      await postar('/api/conciliacao/automatica', { acao: 'excluir_regra', regra_id: excluindo.id });
      toast.success('Regra apagada', 'A próxima conciliação desta descrição começa uma regra nova.');
      setExcluindo(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível apagar.');
    } finally {
      setOcupado(false);
    }
  }

  function abrirTarifa(t: Tarifa) {
    const conta = contas.find(c => c.id === t.conta_bancaria_id);
    setTarifaBanco(conta?.banco || conta?.nome || '');
    setTarifaCategoria('');
    setTarifa(t);
  }

  async function criarTarifa() {
    if (!tarifa) return;
    setOcupado(true);
    try {
      const r = await postar<{ ja_existia: boolean }>('/api/conciliacao/automatica', {
        acao: 'criar_tarifa', chave: tarifa.chave, fornecedor_nome: tarifaBanco, categoria_id: tarifaCategoria || undefined,
      });
      toast.success(r.ja_existia ? 'A conta já estava lançada' : 'Conta a pagar lançada', `Vence em ${formatDate(tarifa.proximo_vencimento)}. Quando o banco debitar, a linha concilia com ela.`);
      setTarifa(null);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível lançar.');
    } finally {
      setOcupado(false);
    }
  }

  // ── Colunas ────────────────────────────────────────────────────────────
  const colSugestoes: FinColuna<Sugestao>[] = [
    { id: 'data', cabecalho: 'Data', tipo: 'data', sortable: true, valor: s => s.data },
    {
      id: 'descricao', cabecalho: 'Descrição no banco', tipo: 'texto', sortable: true, acessor: s => s.descricao,
      render: s => (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{s.descricao}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{nomeDaConta(s.conta_bancaria_id)}</span>
        </span>
      ),
    },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', sortable: true, valor: s => s.valor },
    {
      id: 'sugestao', cabecalho: 'A regra diz', tipo: 'texto',
      render: s => s.decisao.tipo === 'nada' ? null : (
        <span className="flex max-w-[52ch] flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body text-[var(--fin-text)]">{s.decisao.explicacao}</span>
          {s.decisao.tipo === 'sugerir' ? (
            <span className="fin-t-caption text-[var(--fin-text-3)]">{s.decisao.por_que_nao_sozinha}</span>
          ) : (
            <span className="fin-t-caption inline-flex items-center gap-[var(--fin-s-1)] text-[var(--fin-positive)]">
              <Bot aria-hidden="true" className="size-3.5" /> Pronta para conciliar sozinha
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'acoes', cabecalho: 'Ação', tipo: 'acoes',
      render: s => (
        <Button type="button" variant="ghost" className={BOTAO_LINHA} onClick={() => setAplicando(s)}>
          <CheckCircle2 aria-hidden="true" className="size-4" /> Conciliar
        </Button>
      ),
    },
  ];

  const colAutomaticas: FinColuna<Automatica>[] = [
    { id: 'quando', cabecalho: 'Quando', tipo: 'texto', sortable: true, acessor: a => a.executada_em, render: a => <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">{quando(a.executada_em)}</span> },
    { id: 'data', cabecalho: 'Data no banco', tipo: 'data', sortable: true, valor: a => a.data_extrato },
    {
      id: 'descricao', cabecalho: 'Linha e conta', tipo: 'texto', acessor: a => a.descricao,
      render: a => (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{a.descricao}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {a.criou_conta ? `Lançou a conta de ${a.pessoa_nome}` : `Baixou a conta de ${a.pessoa_nome}`}, em {nomeDaConta(a.conta_bancaria_id)}
          </span>
        </span>
      ),
    },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', sortable: true, valor: a => a.valor },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', dominio: 'conferencia', valor: a => (a.desfeita_em ? 'DESFEITA' : 'ATIVA') },
    {
      id: 'acoes', cabecalho: 'Ação', tipo: 'acoes',
      render: a => a.desfeita_em ? (
        <span className="fin-t-caption text-[var(--fin-text-3)]">{a.desfeita_por ? `por ${a.desfeita_por}` : ''}</span>
      ) : (
        <Button type="button" variant="ghost" className={BOTAO_DISCRETO} onClick={() => setDesfazendo(a)} aria-label={`Desfazer a conciliação de ${a.descricao}`}>
          <Undo2 aria-hidden="true" className="size-3.5" /> Desfazer
        </Button>
      ),
    },
  ];

  const colRegras: FinColuna<Regra>[] = [
    {
      id: 'descricao', cabecalho: 'Quando o banco escreve', tipo: 'texto', sortable: true, acessor: r => r.padrao,
      render: r => (
        <span className="flex max-w-[44ch] flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{r.documento ? `CNPJ/CPF ${r.documento}` : `“${r.padrao}”`}</span>
          <span className="fin-t-caption truncate text-[var(--fin-text-3)]" title={r.exemplo}>
            {r.sentido === 'ENTRADA' ? 'Entrada' : 'Saída'} em {nomeDaConta(r.conta_bancaria_id)}{r.exemplo ? `, como “${r.exemplo}”` : ''}
          </span>
        </span>
      ),
    },
    {
      id: 'pessoa', cabecalho: 'É de', tipo: 'texto', sortable: true, acessor: r => r.pessoa_nome,
      render: r => (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body text-[var(--fin-text)]">{r.pessoa_nome || 'Sem nome'}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {r.destino === 'CRIAR' ? (r.titulo_tabela === 'contas_pagar' ? 'Lança a conta paga' : 'Lança o recebimento') : (r.titulo_tabela === 'contas_pagar' ? 'Conta a pagar em aberto' : 'Conta a receber em aberto')}
          </span>
        </span>
      ),
    },
    {
      id: 'certeza', cabecalho: 'Certeza', tipo: 'texto', sortable: true, acessor: r => r.confirmacoes,
      render: r => (
        <span className="flex max-w-[36ch] flex-col gap-[var(--fin-s-1)]">
          <span className={cn('fin-t-body-strong', r.certeza.nivel === 'alta' ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text)]')}>
            {r.certeza.nivel === 'alta' ? 'Alta' : r.certeza.nivel === 'media' ? 'Média' : 'Baixa'}
          </span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{r.auto_suspensa_motivo || r.certeza.texto}</span>
        </span>
      ),
    },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', dominio: 'conferencia', valor: r => (r.auto_ligada ? 'SOZINHA' : 'SUGERE') },
    {
      id: 'acoes', cabecalho: 'Ação', tipo: 'acoes',
      render: r => (
        <span className="inline-flex items-center gap-[var(--fin-s-1)]">
          <Button
            type="button" variant="ghost" className={BOTAO_LINHA}
            disabled={!r.auto_ligada && r.certeza.nivel !== 'alta'}
            title={!r.auto_ligada && r.certeza.nivel !== 'alta' ? r.certeza.texto : undefined}
            onClick={() => void ligar(r, !r.auto_ligada)}
          >
            <Power aria-hidden="true" className="size-4" /> {r.auto_ligada ? 'Desligar' : 'Ligar'}
          </Button>
          <Button type="button" variant="ghost" className={BOTAO_DISCRETO} onClick={() => setExcluindo(r)} aria-label={`Apagar a regra de ${r.pessoa_nome}`}>
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </span>
      ),
    },
  ];

  const colTarifas: FinColuna<Tarifa>[] = [
    {
      id: 'descricao', cabecalho: 'Tarifa', tipo: 'texto', sortable: true, acessor: t => t.descricao,
      render: t => (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{t.descricao}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{nomeDaConta(t.conta_bancaria_id)}, cobrada em {t.meses.length} meses, por volta do dia {t.dia_tipico}</span>
        </span>
      ),
    },
    { id: 'valor', cabecalho: 'Valor típico', tipo: 'dinheiro', sortable: true, valor: t => t.valor_tipico_centavos / 100 },
    { id: 'proximo', cabecalho: 'Próximo débito', tipo: 'data', sortable: true, valor: t => t.proximo_vencimento },
    {
      id: 'acoes', cabecalho: 'Ação', tipo: 'acoes',
      render: t => t.conta_criada_id ? (
        <span className="fin-t-caption inline-flex items-center gap-[var(--fin-s-1)] text-[var(--fin-positive)]"><CheckCircle2 aria-hidden="true" className="size-3.5" /> Lançada</span>
      ) : (
        <Button type="button" variant="ghost" className={BOTAO_LINHA} onClick={() => abrirTarifa(t)}>
          <Receipt aria-hidden="true" className="size-4" /> Lançar conta
        </Button>
      ),
    },
  ];

  const esqueleto = (
    <div className={RITMO_DA_PAGINA}>
      <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <MetricCard key={i} rotulo="Carregando" valor={null} estado="carregando" contexto="..." />)}
      </div>
      <FinTable linhas={[]} colunas={colSugestoes} chave={s => s.extrato_id} estado="carregando" vazio={{ motivo: 'sem-dado', titulo: '', oQueE: '' }} />
    </div>
  );

  const semRegras = (dados?.regras.length ?? 0) === 0;

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Wand2}
        titulo="Conciliação automática"
        subtitulo="O que você concilia vira regra. A regra sugere; com a sua permissão e certeza alta, concilia sozinha a mesma pessoa e o mesmo valor, sempre com desfazer."
        acaoPrimaria={prontas > 0 ? { rotulo: executando ? 'Conciliando...' : `Conciliar ${prontas === 1 ? '1 linha' : `${prontas} linhas`} com certeza`, icone: Sparkles, onClick: () => void executar() } : undefined}
        acoesSecundarias={[{ rotulo: 'Voltar à conciliação', href: '/financeiro-ag/conciliacao' }]}
        onRecarregar={carregar}
      />

      <DataState
        estado={erro ? 'erro' : dados ? 'ok' : 'carregando'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => void carregar() } : null}
        esqueleto={esqueleto}
      >
        <div className={RITMO_DA_PAGINA}>
          <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard rotulo="Sugestões das regras" icone={Sparkles} formato="contagem" valor={sugestoes.length} estado="ok"
              contexto={semConta > 0 ? `${semConta} com regra mas sem conta em aberto` : 'linhas a conciliar com regra'} onClick={() => setAba('sugestoes')} ativo={aba === 'sugestoes'} />
            <MetricCard rotulo="Prontas para ir sozinhas" icone={Bot} formato="contagem" valor={prontas} estado="ok" tone={prontas > 0 ? 'positivo' : 'neutro'}
              contexto="regra ligada, mesma pessoa, mesmo valor" />
            <MetricCard rotulo="Conciliado sozinho" icone={CheckCircle2} formato="contagem" valor={ativas.length} estado="ok"
              contexto="valendo, com desfazer" onClick={() => setAba('sozinha')} ativo={aba === 'sozinha'} />
            <MetricCard rotulo="Regras ligadas" icone={Power} formato="contagem" valor={ligadas} estado="ok"
              contexto={`de ${(dados?.regras.length ?? 0).toLocaleString('pt-BR')} aprendidas`} onClick={() => setAba('regras')} ativo={aba === 'regras'} />
          </div>

          {semRegras ? (
            <Callout tom="info" titulo="Ainda não há regras">
              As regras nascem da fila de conciliação: cada linha que você liga a uma conta ensina de quem é aquela descrição. Depois de três vezes do mesmo jeito, a regra pode ser ligada para conciliar sozinha.
            </Callout>
          ) : null}

          <Segmentado<Aba>
            rotulo="O que ver"
            valor={aba}
            onChange={setAba}
            cheio="celular"
            opcoes={[
              { valor: 'sugestoes', rotulo: 'Sugestões', contagem: sugestoes.length },
              { valor: 'sozinha', rotulo: 'Conciliado sozinho', contagem: (dados?.automaticas ?? []).length },
              { valor: 'regras', rotulo: 'Regras aprendidas', contagem: (dados?.regras ?? []).length },
              { valor: 'tarifas', rotulo: 'Tarifas do banco', contagem: tarifasNovas.length },
            ]}
          />

          {aba === 'sugestoes' && (
            <FinTable linhas={sugestoes} colunas={colSugestoes} chave={s => s.extrato_id} estado="ok"
              vazio={{
                motivo: 'sem-dado', titulo: 'Nenhuma sugestão agora',
                oQueE: 'Quando uma linha do extrato tiver uma regra e uma conta em aberto da mesma pessoa, ela aparece aqui.',
                acao: { rotulo: 'Ir para a fila de conciliação', href: '/financeiro-ag/conciliacao' },
              }} />
          )}
          {aba === 'sozinha' && (
            <FinTable linhas={dados?.automaticas ?? []} colunas={colAutomaticas} chave={a => a.id} estado="ok"
              vazio={{
                motivo: 'sem-dado', titulo: 'Nada foi conciliado sozinho ainda',
                oQueE: 'Só regras que você ligou conciliam sozinhas, e cada uma aparece aqui com o botão para desfazer.',
              }} />
          )}
          {aba === 'regras' && (
            <FinTable linhas={dados?.regras ?? []} colunas={colRegras} chave={r => r.id} estado="ok"
              vazio={{
                motivo: 'sem-dado', titulo: 'Nenhuma regra aprendida',
                oQueE: 'Concilie linhas na fila: cada conciliação com uma conta ensina uma regra.',
                acao: { rotulo: 'Ir para a fila de conciliação', href: '/financeiro-ag/conciliacao' },
              }} />
          )}
          {aba === 'tarifas' && (
            <FinTable linhas={dados?.tarifas ?? []} colunas={colTarifas} chave={t => t.chave} estado="ok"
              vazio={{
                motivo: 'sem-dado', titulo: 'Nenhuma tarifa que se repete',
                oQueE: 'Tarifa de banco cobrada em pelo menos dois meses na mesma conta vira sugestão de conta a pagar.',
              }} />
          )}

          <p className="fin-t-caption flex items-center gap-[var(--fin-s-1)] text-[var(--fin-text-3)]">
            <Landmark aria-hidden="true" className="size-3.5" />
            Toda conciliação automática passa pela liquidação com os mesmos limites e permissões de quem clica. Valor diferente ou outra pessoa nunca conciliam sozinhos.
            <Link href="/financeiro-ag/conciliacao" className="ml-auto inline-flex items-center gap-1 text-[var(--fin-accent)] underline-offset-2 hover:underline">
              <ArrowLeft aria-hidden="true" className="size-3.5" /> Fila de conciliação
            </Link>
          </p>
        </div>
      </DataState>

      <ConfirmDialog
        aberto={aplicando !== null}
        onOpenChange={a => { if (!a) setAplicando(null); }}
        titulo="Conciliar como a regra sugere"
        oQueVaiAcontecer={aplicando && aplicando.decisao.tipo !== 'nada'
          ? (aplicando.decisao.titulo
              ? `A conta de ${aplicando.decisao.regra.pessoa_nome} fica ${aplicando.valor >= 0 ? 'recebida' : 'paga'} com a data e o valor do banco. Se o valor for diferente, o que faltar continua em aberto.`
              : `É lançada a conta de ${aplicando.decisao.regra.pessoa_nome}, já ${aplicando.valor >= 0 ? 'recebida' : 'paga'}, com o valor do banco.`)
          : ''}
        detalhes={aplicando && aplicando.decisao.tipo !== 'nada' ? [
          { rotulo: 'Linha do banco', valor: aplicando.descricao },
          { rotulo: 'Data', valor: formatDate(aplicando.data) },
          { rotulo: 'Valor no banco', valor: <Money valor={aplicando.valor} size="strong" estado="ok" /> },
          ...(aplicando.decisao.titulo ? [{ rotulo: 'Conta', valor: `${aplicando.decisao.titulo.descricao || 'Em aberto'}, ${fmtCent(aplicando.decisao.titulo.aberto_centavos)}` }] : []),
        ] : undefined}
        confirmarRotulo="Conciliar"
        processando={ocupado}
        onConfirmar={aplicarSugestao}
      />

      <ConfirmDialog
        aberto={desfazendo !== null}
        onOpenChange={a => { if (!a) setDesfazendo(null); }}
        titulo="Desfazer a conciliação automática"
        oQueVaiAcontecer="A baixa é estornada (fica no histórico da conta), o saldo da conta bancária volta, a linha volta para a fila e a regra para de conciliar sozinha até ser ligada de novo."
        detalhes={desfazendo ? [
          { rotulo: 'Linha do banco', valor: desfazendo.descricao },
          { rotulo: 'Data', valor: formatDate(desfazendo.data_extrato) },
          { rotulo: 'Valor', valor: <Money valor={desfazendo.valor} size="strong" estado="ok" /> },
          { rotulo: 'Conta', valor: desfazendo.criou_conta ? `Lançada pela regra (será apagada): ${desfazendo.pessoa_nome}` : desfazendo.pessoa_nome },
        ] : undefined}
        confirmarRotulo="Desfazer"
        tone="destrutivo"
        processando={ocupado}
        onConfirmar={desfazer}
      />

      <ConfirmDialog
        aberto={excluindo !== null}
        onOpenChange={a => { if (!a) setExcluindo(null); }}
        titulo="Apagar esta regra"
        oQueVaiAcontecer="A regra deixa de sugerir e de conciliar sozinha. O que ela já conciliou continua como está, com desfazer na lista."
        detalhes={excluindo ? [{ rotulo: 'Descrição', valor: excluindo.documento || excluindo.padrao }, { rotulo: 'Pessoa', valor: excluindo.pessoa_nome }] : undefined}
        confirmarRotulo="Apagar"
        tone="destrutivo"
        processando={ocupado}
        onConfirmar={excluirRegra}
      />

      <RecordSheet
        aberto={tarifa !== null}
        onOpenChange={a => { if (!a) setTarifa(null); }}
        titulo="Lançar a tarifa do próximo mês"
        descricao={tarifa ? `${tarifa.descricao}: ${fmtCent(tarifa.valor_tipico_centavos)}, vence em ${formatDate(tarifa.proximo_vencimento)}.` : undefined}
        acaoPrimaria={{ rotulo: 'Lançar conta a pagar', onClick: criarTarifa, carregando: ocupado, desabilitado: !tarifaBanco.trim() }}
      >
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <Field rotulo="Banco que cobra" obrigatorio ajuda="Aparece como fornecedor da conta a pagar.">
            {a => <Input {...a} className={CONTROLE} value={tarifaBanco} onChange={e => setTarifaBanco(e.target.value)} />}
          </Field>
          <Field rotulo="Categoria" ajuda="Opcional. Ex.: Tarifas bancárias.">
            {a => (
              <Select value={tarifaCategoria || SEM_CATEGORIA} onValueChange={v => setTarifaCategoria(v && v !== SEM_CATEGORIA ? String(v) : '')}>
                <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={cn(CONTROLE, 'justify-between gap-2')}>
                  <SelectValue>{() => despesas.find(c => c.id === tarifaCategoria)?.nome ?? 'Sem categoria'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_CATEGORIA} className="fin-t-body">Sem categoria</SelectItem>
                  {despesas.map(c => <SelectItem key={c.id} value={c.id} className="fin-t-body">{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </Field>
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            A conta nasce em aberto. Quando o débito chegar no extrato, a linha concilia com ela na fila.
          </p>
        </div>
      </RecordSheet>
    </MolduraDaPagina>
  );
}
