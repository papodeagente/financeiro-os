'use client';

/**
 * Conciliação bancária.
 *
 * O extrato do banco é o fato: o que entrou e o que saiu da conta. A tela
 * mostra isso no período (painel), e cada linha se confere numa gaveta que
 * abre ao lado dela, ligando o fato a uma venda ou conta já lançada, ou
 * criando o lançamento que faltava. Tudo pode ser desfeito.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileSpreadsheet, Link2, RotateCcw, Undo2, Upload } from 'lucide-react';

import type { Cliente, ContaBancaria, ContaPagar, ContaReceber, ExtratoLinha, PlanoContas, StatusConciliacao, VendaCRM } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { mesDe, parseMoneyBR, paraISO, round2 } from '@/lib/money';
import { formatBRL, formatDate } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { mesesDoExtrato, painelDoExtrato } from '@/lib/conciliacao-plano';
import { criarLeitorNdjson } from '@/lib/importacao-progresso';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson, type EmptyLessonProps } from '@/components/fin/EmptyLesson';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { ImportacaoDeExtrato, type EstadoDaImportacao } from '@/components/fin/ImportacaoDeExtrato';
import { Jargao } from '@/components/fin/Jargao';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { PageHeader } from '@/components/fin/PageHeader';
import { rotuloDoMes } from '@/components/fin/SeletorDeMes';
import { rotuloStatus } from '@/components/fin/StatusChip';

import { GavetaDeConciliacao } from './GavetaDeConciliacao';

// Linha crua vinda do arquivo. `fitid` só existe em OFX — é o identificador
// da transação no banco e serve de chave de deduplicação na reimportação.
interface LinhaArquivo {
  data: string;
  descricao: string;
  valor: number;
  fitid?: string;
}

function parseCSV(text: string): LinhaArquivo[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  // Try to detect columns
  const cols = header.split(/[;,\t]/);
  const dateIdx = cols.findIndex(c => c.includes('data') || c.includes('date'));
  const descIdx = cols.findIndex(c => c.includes('desc') || c.includes('hist') || c.includes('memo'));
  const valIdx = cols.findIndex(c => c.includes('valor') || c.includes('amount') || c.includes('value'));

  const result: LinhaArquivo[] = [];
  const sep = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(sep).map(p => p.replace(/^"|"$/g, '').trim());
    if (parts.length < 3) continue;

    const rawDate = parts[dateIdx >= 0 ? dateIdx : 0];
    const desc = parts[descIdx >= 0 ? descIdx : 1];
    // parseMoneyBR decide qual separador é decimal. Limpar o ponto na mão
    // transformava 1234.56 em 123456 (valor 100x maior).
    const valor = parseMoneyBR(parts[valIdx >= 0 ? valIdx : 2]);
    if (valor === null) continue;

    // Parse date (DD/MM/YYYY or YYYY-MM-DD)
    let isoDate = rawDate;
    if (rawDate.includes('/')) {
      const [d, m, y] = rawDate.split('/');
      isoDate = `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    result.push({ data: paraISO(isoDate), descricao: desc, valor: round2(valor) });
  }
  return result;
}

function parseOFX(text: string): LinhaArquivo[] {
  const result: LinhaArquivo[] = [];
  const transactions = text.split('<STMTTRN>').slice(1);

  for (const tx of transactions) {
    const getTag = (tag: string) => {
      const match = tx.match(new RegExp(`<${tag}>([^<\\n]+)`));
      return match ? match[1].trim() : '';
    };

    const rawDate = getTag('DTPOSTED');
    const fitid = getTag('FITID');
    const desc = getTag('MEMO') || getTag('NAME') || fitid;
    const valor = parseMoneyBR(getTag('TRNAMT'));
    if (valor === null || !rawDate) continue;

    const isoDate = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}`;
    result.push({ data: isoDate, descricao: desc, valor: round2(valor), ...(fitid ? { fitid } : {}) });
  }
  return result;
}


/** Lê o arquivo avisando quantos bytes já vieram (a primeira etapa da barra). */
function lerArquivo(file: File, aoLer: (bytes: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onprogress = e => { if (e.lengthComputable) aoLer(e.loaded); };
    leitor.onload = () => resolve(String(leitor.result ?? ''));
    leitor.onerror = () => reject(leitor.error ?? new Error('Não foi possível ler o arquivo.'));
    leitor.readAsText(file);
  });
}

/** Deixa o navegador pintar a etapa antes de seguir para a próxima. */
const quadro = () => new Promise<void>(r => requestAnimationFrame(() => r()));

class ErroDeImportacao extends Error {
  nadaGravado: boolean;
  constructor(mensagem: string, nadaGravado: boolean) {
    super(mensagem);
    this.nadaGravado = nadaGravado;
  }
}

async function putJSON<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || 'Falha ao gravar no servidor.');
  return body as T;
}

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';

const BOTAO_LINHA = [
  'fin-t-body h-10 max-lg:h-11 gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-3 shadow-none',
  'border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)]',
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
  FOCO,
].join(' ');

const BOTAO_SECUNDARIO = [
  'fin-t-body h-11 lg:h-10 gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-4 shadow-none',
  'border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text-2)]',
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
  FOCO,
].join(' ');

const BOTAO_DISCRETO = [
  'fin-t-caption h-9 gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-2 shadow-none',
  'bg-transparent text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
  FOCO,
].join(' ');

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]';

const SITUACOES: readonly (StatusConciliacao | 'TODOS')[] = [
  'TODOS',
  'PENDENTE',
  'CONCILIADO',
  'DIVERGENTE',
  'IGNORADO',
];

function contarLinhas(n: number): string {
  return n === 1 ? '1 linha' : `${n.toLocaleString('pt-BR')} linhas`;
}

const A_CONFERIR = new Set<StatusConciliacao>(['PENDENTE', 'DIVERGENTE']);

export default function ConciliacaoPage() {
  const router = useRouter();
  const [extrato, setExtrato] = useState<ExtratoLinha[]>([]);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConta, setSelectedConta] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusConciliacao | 'TODOS'>('TODOS');
  const [searchTerm, setSearchTerm] = useState('');
  const [periodo, setPeriodo] = useState('');

  const [importacao, setImportacao] = useState<EstadoDaImportacao | null>(null);
  const [gavetaId, setGavetaId] = useState<string | null>(null);
  const [vendaInicial, setVendaInicial] = useState<string | null>(null);
  // Linhas que o usuário mandou para o fim da fila. Só apresentação.
  const [adiadas, setAdiadas] = useState<Set<string>>(new Set());
  const [desfazendo, setDesfazendo] = useState<ExtratoLinha | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  // Silenciosa: depois de conciliar, recarrega sem trocar a tela pelo
  // esqueleto (a gaveta segue aberta na próxima linha).
  const load = useCallback(async (silenciosa = false) => {
    if (!silenciosa) setLoading(true);
    const [e, c, cr, cp, v, cl, pc] = await Promise.all([
      loadEntities<ExtratoLinha>('extrato-bancario'),
      loadEntities<ContaBancaria>('contas-bancarias'),
      loadEntities<ContaReceber>('contas-receber'),
      loadEntities<ContaPagar>('contas-pagar'),
      loadEntities<VendaCRM>('vendas-crm'),
      loadEntities<Cliente>('clientes'),
      loadEntities<PlanoContas>('plano-contas'),
    ]);
    setExtrato(e);
    setContas(c);
    setContasReceber(cr);
    setContasPagar(cp);
    setVendas(v);
    setClientes(cl);
    setPlanoContas(pc);
    setSelectedConta(atual => atual || c[0]?.id || '');
    setLoading(false);
    return e;
  }, []);

  // Volta do formulário de venda: ?linha=<extrato>&venda=<venda> reabre a
  // gaveta na mesma linha, com a venda recém-criada já escolhida.
  useEffect(() => {
    void load().then(linhas => {
      const q = new URLSearchParams(window.location.search);
      const linhaId = q.get('linha');
      if (!linhaId) return;
      const alvo = linhas.find(l => l.id === linhaId);
      if (alvo) {
        setSelectedConta(alvo.conta_bancaria_id);
        setVendaInicial(q.get('venda'));
        setGavetaId(alvo.id);
      }
      window.history.replaceState(null, '', window.location.pathname);
    });
  }, [load]);

  // ── Importação ─────────────────────────────────────────────────────────
  // A importação inteira roda no servidor (/api/conciliacao/importar): lá ela
  // é deduplicada contra o que já existe na conta e gravada numa única
  // transação. A tela acompanha o andamento que o servidor manda.
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !selectedConta) return;
    const conta = contas.find(c => c.id === selectedConta);
    const atualizar = (parcial: Partial<EstadoDaImportacao>) => setImportacao(s => (s ? { ...s, ...parcial } : s));

    setImportacao({
      fase: 'lendo',
      arquivo: { nome: file.name, tamanho: file.size },
      conta: conta?.nome ?? 'a conta escolhida',
      lidoBytes: 0,
      linhas: [],
      feitas: 0,
      total: 0,
    });

    try {
      const text = await lerArquivo(file, bytes => atualizar({ lidoBytes: bytes }));
      atualizar({ fase: 'reconhecendo', lidoBytes: file.size });
      await quadro();
      const isOFX = file.name.toLowerCase().endsWith('.ofx') || file.name.toLowerCase().endsWith('.qfx');
      const parsed = isOFX ? parseOFX(text) : parseCSV(text);
      if (parsed.length === 0) {
        atualizar({ fase: 'vazio' });
        return;
      }
      atualizar({ fase: 'conferindo', linhas: parsed, total: parsed.length });

      let res: Response;
      try {
        res = await fetch('/api/conciliacao/importar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
          body: JSON.stringify({ conta_bancaria_id: selectedConta, arquivo_origem: file.name, linhas: parsed }),
        });
      } catch {
        throw new ErroDeImportacao('Sem conexão com o servidor. Confira a internet e tente de novo.', true);
      }
      if (!res.ok) {
        const corpo = await res.json().catch(() => null);
        throw new ErroDeImportacao(corpo?.error || 'O servidor recusou o arquivo.', true);
      }

      let resultado: { inseridas: number; duplicadas: number } | null = null;
      const tratar = (ev: Record<string, unknown>) => {
        if (ev.fase === 'gravando') atualizar({ fase: 'gravando', feitas: Number(ev.feitas) || 0, total: Number(ev.total) || parsed.length });
        else if (ev.fase === 'pronto') resultado = { inseridas: Number(ev.inseridas) || 0, duplicadas: Number(ev.duplicadas) || 0 };
        else if (ev.fase === 'erro') throw new ErroDeImportacao(String(ev.error || 'O servidor não conseguiu gravar.'), ev.gravou === false);
      };

      if ((res.headers.get('content-type') ?? '').includes('ndjson') && res.body) {
        const leitor = res.body.getReader();
        const decodificador = new TextDecoder();
        const ndjson = criarLeitorNdjson();
        try {
          for (;;) {
            const { done, value } = await leitor.read();
            if (done) break;
            ndjson.empurrar(decodificador.decode(value, { stream: true })).forEach(tratar);
          }
        } catch (err) {
          if (err instanceof ErroDeImportacao) throw err;
          throw new ErroDeImportacao('A conexão caiu durante a importação.', false);
        }
        ndjson.empurrar(decodificador.decode()).forEach(tratar);
        ndjson.fechar().forEach(tratar);
      } else {
        const corpo = await res.json().catch(() => null);
        if (corpo) resultado = { inseridas: Number(corpo.inseridas) || 0, duplicadas: Number(corpo.duplicadas) || 0 };
      }
      if (!resultado) throw new ErroDeImportacao('A conexão caiu antes da resposta final.', false);
      atualizar({ fase: 'pronto', feitas: parsed.length, total: parsed.length, resultado });
    } catch (err) {
      const nadaGravado = err instanceof ErroDeImportacao ? err.nadaGravado : true;
      atualizar({
        fase: 'erro',
        erro: { mensagem: err instanceof Error ? err.message : 'Falha ao importar o extrato.', nadaGravado },
      });
    } finally {
      void load(true);
    }
  }

  // ── Recortes ───────────────────────────────────────────────────────────
  // Contas já amarradas a alguma linha CONCILIADA (de qualquer conta
  // bancária): não podem ser oferecidas de novo.
  const idsJaConciliados = useMemo(() => {
    const ids = new Set<string>();
    for (const e of extrato) {
      if (e.status_conciliacao !== 'CONCILIADO') continue;
      if (e.lancamento_vinculado_id) ids.add(e.lancamento_vinculado_id);
      for (const v of e.vinculos ?? []) ids.add(v.id);
    }
    return ids;
  }, [extrato]);

  const contaExtrato = useMemo(() => extrato.filter(e => e.conta_bancaria_id === selectedConta), [extrato, selectedConta]);
  const meses = useMemo(() => mesesDoExtrato(contaExtrato), [contaExtrato]);
  const noPeriodo = useMemo(
    () => (periodo ? contaExtrato.filter(e => mesDe(e.data) === periodo) : contaExtrato),
    [contaExtrato, periodo],
  );
  const painel = useMemo(() => painelDoExtrato(noPeriodo), [noPeriodo]);

  const filtered = useMemo(() => noPeriodo.filter(e => {
    if (filterStatus !== 'TODOS' && e.status_conciliacao !== filterStatus) return false;
    if (searchTerm && !e.descricao.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id)), [noPeriodo, filterStatus, searchTerm]);

  // A fila: o que ainda está a conferir no recorte visível, menos o que foi
  // deixado para depois.
  const fila = filtered.filter(e => e.status_conciliacao === 'PENDENTE');
  const filaAtiva = fila.filter(e => !adiadas.has(e.id));
  const proxima = filaAtiva[0] ?? null;

  const linhaNaGaveta = gavetaId ? extrato.find(e => e.id === gavetaId) ?? null : null;
  const posicaoNaFila = linhaNaGaveta ? filaAtiva.findIndex(e => e.id === linhaNaGaveta.id) : -1;

  const estadoDados: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : 'ok';
  const contaSelecionada = contas.find(c => c.id === selectedConta) ?? null;
  const filtrosAtivos = (filterStatus !== 'TODOS' ? 1 : 0) + (searchTerm.trim() ? 1 : 0) + (periodo ? 1 : 0);

  function limparFiltros() {
    setFilterStatus('TODOS');
    setSearchTerm('');
    setPeriodo('');
  }

  function abrirSeletorDeArquivo() {
    inputArquivoRef.current?.click();
  }

  function abrirGaveta(linha: ExtratoLinha) {
    setVendaInicial(null);
    setAdiadas(prev => {
      if (!prev.has(linha.id)) return prev;
      const n = new Set(prev);
      n.delete(linha.id);
      return n;
    });
    setGavetaId(linha.id);
  }

  /** A linha seguinte da fila depois desta, dando a volta; null se acabou. */
  function seguinte(id: string, semEsta = true): string | null {
    const i = filaAtiva.findIndex(e => e.id === id);
    const ordem = i >= 0 ? [...filaAtiva.slice(i + 1), ...filaAtiva.slice(0, i)] : filaAtiva;
    return ordem.find(e => !semEsta || e.id !== id)?.id ?? null;
  }

  async function aposConciliar(mensagem: string) {
    if (!linhaNaGaveta) return;
    const proximaId = seguinte(linhaNaGaveta.id);
    toast.success(mensagem);
    setVendaInicial(null);
    await load(true);
    setGavetaId(proximaId);
    if (!proximaId) toast.success('Fila conferida', 'Não há mais linhas a conferir neste recorte.');
  }

  function pular() {
    if (!linhaNaGaveta) return;
    const proximaId = seguinte(linhaNaGaveta.id);
    setAdiadas(prev => new Set(prev).add(linhaNaGaveta.id));
    setVendaInicial(null);
    setGavetaId(proximaId);
  }

  async function marcarStatus(linha: ExtratoLinha, status: StatusConciliacao): Promise<boolean> {
    try {
      await putJSON<ExtratoLinha>(`/api/extrato-bancario/${linha.id}`, { ...linha, status_conciliacao: status });
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar a linha do extrato.');
      return false;
    }
  }

  async function marcarNaGaveta(status: 'IGNORADO' | 'DIVERGENTE') {
    if (!linhaNaGaveta) return;
    const proximaId = seguinte(linhaNaGaveta.id);
    if (!(await marcarStatus(linhaNaGaveta, status))) return;
    toast.success(status === 'IGNORADO' ? 'Linha ignorada' : 'Linha marcada como divergente');
    await load(true);
    setGavetaId(proximaId);
  }

  async function reabrir(linha: ExtratoLinha) {
    if (await marcarStatus(linha, 'PENDENTE')) {
      toast.success('A linha voltou para a fila');
      await load(true);
    }
  }

  async function confirmarDesfazer() {
    if (!desfazendo || confirmando) return;
    setConfirmando(true);
    try {
      const r = await fetch('/api/conciliacao/conciliar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'desfazer', extrato_id: desfazendo.id }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || 'Não foi possível desfazer.');
      toast.success('Conciliação desfeita', 'A linha voltou para a fila e as contas ao que eram.');
      setDesfazendo(null);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível desfazer.');
    } finally {
      setConfirmando(false);
    }
  }

  function criarVenda(linha: ExtratoLinha, contraparte: string) {
    const q = new URLSearchParams({
      extrato: linha.id,
      valor: String(round2(Math.abs(linha.valor))),
      data: linha.data,
      descricao: contraparte || linha.descricao,
    });
    router.push(`/vendas/nova?${q.toString()}`);
  }

  const colunas: FinColuna<ExtratoLinha>[] = [
    {
      id: 'data',
      cabecalho: 'Data',
      tipo: 'data',
      sortable: true,
      minWidth: 92,
      valor: linha => linha.data,
    },
    {
      id: 'descricao',
      cabecalho: 'Descrição no banco',
      tipo: 'texto',
      sortable: true,
      acessor: linha => linha.descricao,
      render: linha => (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{linha.descricao}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {linha.tipo === 'CREDITO' ? 'Entrada na conta' : 'Saída da conta'}
          </span>
        </span>
      ),
    },
    {
      id: 'valor',
      cabecalho: 'Valor',
      tipo: 'dinheiro',
      sortable: true,
      minWidth: 112,
      valor: linha => linha.valor,
    },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      tipo: 'status',
      sortable: true,
      dominio: 'conciliacao',
      valor: linha => linha.status_conciliacao,
    },
    {
      id: 'acoes',
      cabecalho: 'Ação',
      tipo: 'acoes',
      render: linha =>
        A_CONFERIR.has(linha.status_conciliacao) ? (
          <Button type="button" variant="ghost" className={BOTAO_LINHA} onClick={() => abrirGaveta(linha)}>
            <Link2 aria-hidden="true" className="size-4" />
            Conferir
          </Button>
        ) : linha.status_conciliacao === 'CONCILIADO' ? (
          <span className="inline-flex items-center gap-[var(--fin-s-2)]">
            <span className="fin-t-caption inline-flex items-center gap-[var(--fin-s-1)] text-[var(--fin-positive)]">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              Conferido
            </span>
            <Button type="button" variant="ghost" className={BOTAO_DISCRETO} onClick={() => setDesfazendo(linha)} aria-label={`Desfazer a conciliação de ${linha.descricao}`}>
              <Undo2 aria-hidden="true" className="size-3.5" />
              Desfazer
            </Button>
          </span>
        ) : (
          <Button type="button" variant="ghost" className={BOTAO_DISCRETO} onClick={() => void reabrir(linha)}>
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Reabrir
          </Button>
        ),
    },
  ];

  const vazioTabela: EmptyLessonProps = filtrosAtivos > 0
    ? {
        motivo: 'sem-resultado',
        titulo: 'Nenhuma linha com esses filtros',
        oQueE: 'A conta tem lançamentos importados, mas nenhum deles atende à busca, ao mês e à situação escolhidos.',
        acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limparFiltros },
      }
    : {
        motivo: 'sem-dado',
        titulo: 'Nenhum extrato importado nesta conta',
        oQueE: 'Aqui aparecem as linhas do extrato do banco, para você conferir uma a uma com os lançamentos do sistema.',
        comoComeca: [
          'Baixe o extrato no site do banco em CSV ou OFX.',
          'Confira se a conta escolhida na barra de filtros é a mesma do arquivo.',
          'Clique em Importar extrato e escolha o arquivo baixado.',
        ],
        acao: { rotulo: 'Importar extrato', onClick: abrirSeletorDeArquivo },
      };

  // O esqueleto tem a forma do conteúdo real: filtros, painel, fila e tabela.
  const esqueletoTela = (
    <div className="flex flex-col gap-[var(--fin-s-5)]">
      <div className={`${CARTAO} h-12 w-full`} />
      <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`${CARTAO} flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`}>
            <span className="block h-[11px] w-28 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
            <Money valor={null} size="metricSm" align="esquerda" estado="carregando" />
            <span className="block h-[12px] w-40 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          </div>
        ))}
      </div>
      <FinTable linhas={[]} colunas={colunas} chave={linha => linha.id} estado="carregando" vazio={vazioTabela} />
    </div>
  );

  const periodoLegivel = painel.de
    ? painel.de === painel.ate
      ? formatDate(painel.de)
      : `${formatDate(painel.de)} a ${formatDate(painel.ate)}`
    : '';

  return (
    <div className="min-h-full bg-[var(--fin-bg)] px-[var(--fin-page-pad)] py-[var(--fin-s-5)] text-[var(--fin-text)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-6)]">

        <PageHeader
          titulo="Conciliação bancária"
          subtitulo="O extrato do banco é o fato. Ligue cada linha à venda ou à conta que ela quita, ou lance o que faltava."
          acaoPrimaria={
            selectedConta
              ? { rotulo: importacao ? 'Importando o arquivo' : 'Importar extrato', icone: Upload, onClick: abrirSeletorDeArquivo }
              : undefined
          }
          onRecarregar={async () => { await load(); }}
        />

        {/* O seletor de arquivo fica fora de vista: quem abre é o botão. */}
        <Input
          ref={inputArquivoRef}
          type="file"
          accept=".csv,.ofx,.qfx,.txt"
          onChange={handleImport}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />

        <DataState estado={estadoDados} erro={null} esqueleto={esqueletoTela}>
          {contas.length === 0 ? (
            <EmptyLesson
              motivo="sem-dado"
              titulo="Cadastre uma conta bancária primeiro"
              oQueE="A conciliação compara o extrato de uma conta do banco com os lançamentos do sistema, então ela precisa saber de qual conta o arquivo veio."
              comoComeca={[
                'Abra Contas bancárias e cadastre a conta com saldo inicial.',
                'Volte para esta tela e escolha a conta na barra de filtros.',
                'Importe o extrato em CSV ou OFX.',
              ]}
              acao={{ rotulo: 'Ir para contas bancárias', href: '/financeiro-ag/contas-bancarias' }}
            />
          ) : (
            <div className="flex flex-col gap-[var(--fin-s-5)]">
              <FilterBar
                busca={{ valor: searchTerm, onChange: setSearchTerm, placeholder: 'Buscar na descrição do extrato' }}
                selects={[
                  {
                    id: 'conta-bancaria',
                    rotulo: 'Conta',
                    valor: selectedConta,
                    opcoes: contas.map(c => ({ valor: c.id, rotulo: c.nome })),
                    onChange: v => { setSelectedConta(v); setPeriodo(''); },
                  },
                  {
                    id: 'periodo-extrato',
                    rotulo: 'Mês',
                    valor: periodo,
                    opcoes: [{ valor: '', rotulo: 'Todo o extrato' }, ...meses.map(m => ({ valor: m, rotulo: rotuloDoMes(m) }))],
                    onChange: setPeriodo,
                  },
                  {
                    id: 'situacao-conciliacao',
                    rotulo: 'Situação',
                    valor: filterStatus,
                    opcoes: SITUACOES.map(s => ({
                      valor: s,
                      rotulo: s === 'TODOS' ? 'Todas' : rotuloStatus('conciliacao', s),
                    })),
                    onChange: v => setFilterStatus(v as StatusConciliacao | 'TODOS'),
                  },
                ]}
                resumo={{ exibidos: filtered.length, total: contaExtrato.length, substantivo: 'linhas do extrato' }}
                ativos={filtrosAtivos}
                onLimpar={limparFiltros}
              />

              {/* O que o banco diz do período */}
              {noPeriodo.length > 0 && (
                <section aria-label="Movimento da conta no período" className="flex flex-col gap-[var(--fin-s-3)]">
                  <h2 className="fin-t-overline text-[var(--fin-text-3)]">
                    {contaSelecionada?.nome ?? 'Conta'}, {periodo ? rotuloDoMes(periodo) : 'todo o extrato'}: {periodoLegivel}
                  </h2>
                  <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 lg:grid-cols-4">
                    <MetricCard
                      rotulo="Entrou na conta"
                      valor={painel.entrou}
                      estado="ok"
                      tone="positivo"
                      contexto={`${painel.creditos.toLocaleString('pt-BR')} ${painel.creditos === 1 ? 'crédito' : 'créditos'} no extrato`}
                    />
                    <MetricCard
                      rotulo="Saiu da conta"
                      valor={painel.saiu}
                      estado="ok"
                      contexto={`${painel.debitos.toLocaleString('pt-BR')} ${painel.debitos === 1 ? 'débito' : 'débitos'} no extrato`}
                    />
                    <MetricCard
                      rotulo="Resultado do período"
                      valor={painel.resultado}
                      estado="ok"
                      tone={painel.resultado >= 0 ? 'positivo' : 'negativo'}
                      contexto={painel.resultado >= 0 ? 'entrou mais do que saiu' : 'saiu mais do que entrou'}
                    />
                    <MetricCard
                      rotulo="Ainda a conferir"
                      valor={painel.a_conferir_valor}
                      estado="ok"
                      contexto={`${contarLinhas(painel.a_conferir)} de ${painel.linhas.toLocaleString('pt-BR')}, somando entradas e saídas`}
                      explicacao="Soma, sem sinal, das linhas que ainda não têm lançamento ligado. Linhas ignoradas contam como conferidas."
                    />
                  </div>
                  <div className="flex items-center gap-[var(--fin-s-3)]">
                    <div
                      role="progressbar"
                      aria-label="Linhas do extrato já conferidas"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={painel.pct_conferido}
                      aria-valuetext={`${painel.pct_conferido}% do extrato conferido`}
                      className="h-1.5 flex-1 overflow-hidden rounded-[var(--fin-r-dot)] bg-[var(--fin-surface-2)]"
                    >
                      <div className="h-full rounded-[var(--fin-r-dot)] bg-[var(--fin-accent)] transition-[width] duration-500" style={{ width: `${painel.pct_conferido}%` }} />
                    </div>
                    <span className="fin-t-caption shrink-0 tabular-nums text-[var(--fin-text-2)]">
                      {painel.conferidas.toLocaleString('pt-BR')} de {painel.linhas.toLocaleString('pt-BR')} conferidas ({painel.pct_conferido}%)
                    </span>
                  </div>
                </section>
              )}

              {/* A próxima da fila */}
              {proxima ? (
                <section className={`${CARTAO} flex flex-wrap items-center justify-between gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`} aria-label="Próxima linha a conferir">
                  <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
                    <span className="fin-t-overline text-[var(--fin-text-3)]">
                      Próxima a conferir, {filaAtiva.length.toLocaleString('pt-BR')} na fila
                    </span>
                    <span className="fin-t-body-strong truncate text-[var(--fin-text)]">{proxima.descricao}</span>
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      {formatDate(proxima.data)}, {proxima.tipo === 'CREDITO' ? 'entrada' : 'saída'} de {formatBRL(Math.abs(proxima.valor))}
                    </span>
                  </div>
                  <Button
                    type="button"
                    className="h-11 gap-[var(--fin-s-1)] bg-[var(--fin-accent)] px-4 text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] lg:h-10"
                    onClick={() => abrirGaveta(proxima)}
                  >
                    <Link2 aria-hidden="true" className="size-4" />
                    Conferir em sequência
                  </Button>
                </section>
              ) : contaExtrato.length === 0 ? null : adiadas.size > 0 && fila.length > 0 ? (
                <EmptyLesson
                  motivo="sem-resultado"
                  titulo="A fila está vazia por enquanto"
                  oQueE={`${contarLinhas(fila.length)} do extrato ${fila.length === 1 ? 'foi deixada' : 'foram deixadas'} para depois. Retome a fila quando quiser continuar a conferência.`}
                  acaoSecundaria={{ rotulo: 'Retomar linhas adiadas', onClick: () => setAdiadas(new Set()) }}
                />
              ) : painel.a_conferir > 0 && filtrosAtivos > 0 ? (
                <EmptyLesson
                  motivo="sem-resultado"
                  titulo="As linhas a conferir estão fora do filtro"
                  oQueE={`Este recorte ainda tem ${contarLinhas(painel.a_conferir)} a conferir, mas a busca ou a situação escolhida não mostra nenhuma delas.`}
                  acaoSecundaria={{ rotulo: 'Limpar filtros', onClick: limparFiltros }}
                />
              ) : (
                <section className={`${CARTAO} flex items-start gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`}>
                  <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]">
                    <CheckCircle2 className="size-5" />
                  </span>
                  <div className="flex flex-col gap-[var(--fin-s-1)]">
                    <h2 className="fin-t-subhead text-[var(--fin-text)]">Nada na fila desta conta</h2>
                    <p className="fin-t-caption text-[var(--fin-text-2)]">
                      Todas as linhas importadas já foram conferidas ou ignoradas. Divergentes ficam na tabela com o botão Conferir.
                    </p>
                  </div>
                </section>
              )}

              {/* Extrato completo */}
              <section className="flex flex-col gap-[var(--fin-s-3)]" aria-label="Linhas do extrato">
                <h2 className="fin-t-subhead text-[var(--fin-text)]">Extrato importado</h2>
                <FinTable
                  linhas={filtered}
                  colunas={colunas}
                  chave={linha => linha.id}
                  estado={estadoDados}
                  vazio={vazioTabela}
                  onLinhaClick={linha => { if (A_CONFERIR.has(linha.status_conciliacao)) abrirGaveta(linha); }}
                />
              </section>

              {/* Importação */}
              <section className={`${CARTAO} flex flex-col items-start gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`} aria-label="Importar extrato">
                <h2 className="fin-t-overline text-[var(--fin-text-3)]">Importar extrato</h2>
                <div className="flex w-full flex-col items-center gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-dashed border-[var(--fin-border-strong)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-5)] text-center">
                  <span aria-hidden="true" className="grid size-10 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]">
                    <FileSpreadsheet className="size-5" />
                  </span>
                  <p className="fin-t-body-strong text-[var(--fin-text)]">
                    {contaExtrato.length === 0
                      ? 'Nenhum arquivo importado nesta conta ainda'
                      : `${contarLinhas(contaExtrato.length)} no extrato desta conta, ${contaExtrato.filter(e => A_CONFERIR.has(e.status_conciliacao)).length.toLocaleString('pt-BR')} ainda a conferir`}
                  </p>
                  <p className="fin-t-caption max-w-[60ch] text-[var(--fin-text-2)]">
                    Aceita planilha em CSV ou o arquivo do banco no{' '}
                    <Jargao
                      comum="formato padrão de extrato"
                      tecnico="OFX"
                      explicacao="Formato que os bancos usam para exportar extrato. No site do banco, procure por exportar extrato e escolha OFX."
                    />
                    . Importar o mesmo arquivo duas vezes não duplica lançamentos: o servidor
                    reconhece o que já existe na conta.
                  </p>
                  <Button type="button" variant="ghost" className={BOTAO_SECUNDARIO} disabled={importacao !== null || !selectedConta} onClick={abrirSeletorDeArquivo}>
                    <Upload aria-hidden="true" className="size-4" />
                    Escolher arquivo
                  </Button>
                </div>
              </section>
            </div>
          )}
        </DataState>
      </div>

      <GavetaDeConciliacao
        linha={linhaNaGaveta}
        posicao={posicaoNaFila >= 0 ? { atual: posicaoNaFila + 1, total: filaAtiva.length } : null}
        contasBancarias={contas}
        contasReceber={contasReceber}
        contasPagar={contasPagar}
        vendas={vendas}
        clientes={clientes}
        planoContas={planoContas}
        idsJaConciliados={idsJaConciliados}
        vendaInicial={vendaInicial}
        onFechar={() => { setGavetaId(null); setVendaInicial(null); }}
        onConciliada={aposConciliar}
        onPular={pular}
        onMarcar={marcarNaGaveta}
        onCriarVenda={criarVenda}
      />

      <ImportacaoDeExtrato
        estado={importacao}
        onFechar={() => setImportacao(null)}
        onEscolherOutro={() => { setImportacao(null); abrirSeletorDeArquivo(); }}
      />

      <ConfirmDialog
        aberto={desfazendo !== null}
        onOpenChange={aberto => { if (!aberto) setDesfazendo(null); }}
        titulo="Desfazer esta conciliação"
        oQueVaiAcontecer="A linha volta para a fila. As contas que ela baixou voltam ao que eram, a conta que foi criada aqui é apagada, e o saldo da conta bancária acompanha."
        detalhes={desfazendo ? [
          { rotulo: 'Linha do extrato', valor: desfazendo.descricao },
          { rotulo: 'Data', valor: formatDate(desfazendo.data) },
          { rotulo: 'Valor no extrato', valor: <Money valor={desfazendo.valor} size="strong" estado="ok" /> },
        ] : undefined}
        confirmarRotulo="Desfazer"
        tone="destrutivo"
        processando={confirmando}
        onConfirmar={confirmarDesfazer}
      />
    </div>
  );
}
