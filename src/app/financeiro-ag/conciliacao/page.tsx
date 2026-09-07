'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CheckCircle2, FileSpreadsheet, Link2, Upload } from 'lucide-react';

import { ExtratoLinha, ContaBancaria, ContaReceber, ContaPagar, StatusConciliacao } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { parseMoneyBR, round2, divSegura, paraISO, somaPor } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { toast } from '@/lib/toast';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson, type EmptyLessonProps } from '@/components/fin/EmptyLesson';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { Jargao } from '@/components/fin/Jargao';
import { Money } from '@/components/fin/Money';
import { PageHeader } from '@/components/fin/PageHeader';
import { rotuloStatus } from '@/components/fin/StatusChip';

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

// Leitura/gravação que ESTOURA em erro — conciliação precisa saber se a
// segunda escrita falhou para desfazer a primeira.
async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(body?.error || 'Lançamento não encontrado no servidor.');
  return body as T;
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
  'fin-t-body h-11 lg:h-10 gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-4 shadow-none',
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

/**
 * `findMatches` monta a descrição do lançamento com travessão. A string do
 * servidor não muda; aqui ela só é partida em nome e complemento para caber
 * nas duas linhas do cartão, sem travessão na tela.
 */
function partirDescricao(desc: string): { titulo: string; complemento: string | null } {
  const partes = desc.split(' — ');
  if (partes.length < 2) return { titulo: desc, complemento: null };
  return { titulo: partes[0], complemento: partes.slice(1).join(', ') };
}

/** Custom property da barra, no mesmo mecanismo do primitivo Meter. */
function estiloBarra(pct: number): CSSProperties {
  return { ['--fin-meter' as string]: `${pct}%` } as CSSProperties;
}

function contarLinhas(n: number): string {
  return n === 1 ? '1 linha' : `${n} linhas`;
}

function descricaoLegivel(desc: string): string {
  const { titulo, complemento } = partirDescricao(desc);
  return complemento ? `${titulo}, ${complemento}` : titulo;
}

type AcaoPendente =
  | {
      tipo: 'conciliar';
      linha: ExtratoLinha;
      lancId: string;
      lancTipo: 'CONTA_RECEBER' | 'CONTA_PAGAR';
      lancDesc: string;
      lancValor: number;
    }
  | { tipo: 'ignorar'; linha: ExtratoLinha }
  | { tipo: 'divergente'; linha: ExtratoLinha };

export default function ConciliacaoPage() {
  const [extrato, setExtrato] = useState<ExtratoLinha[]>([]);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [contasReceber, setContasReceber] = useState<ContaReceber[]>([]);
  const [contasPagar, setContasPagar] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [conciliando, setConciliando] = useState(false);
  const [selectedConta, setSelectedConta] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusConciliacao | 'TODOS'>('TODOS');
  const [searchTerm, setSearchTerm] = useState('');

  // Conciliation modal
  const [conciliarItem, setConciliarItem] = useState<ExtratoLinha | null>(null);

  // Estado só de apresentação: linhas que o usuário mandou para o fim da fila
  // e a confirmação aberta. Nada disso é gravado no servidor.
  const [adiadas, setAdiadas] = useState<Set<string>>(new Set());
  const [acaoPendente, setAcaoPendente] = useState<AcaoPendente | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const [e, c, cr, cp] = await Promise.all([
      loadEntities<ExtratoLinha>('extrato-bancario'),
      loadEntities<ContaBancaria>('contas-bancarias'),
      loadEntities<ContaReceber>('contas-receber'),
      loadEntities<ContaPagar>('contas-pagar'),
    ]);
    setExtrato(e);
    setContas(c);
    setContasReceber(cr);
    setContasPagar(cp);
    if (c.length > 0 && !selectedConta) setSelectedConta(c[0].id);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // A importação inteira roda no servidor (/api/conciliacao/importar): lá ela
  // é deduplicada contra o que já existe na conta e gravada numa única
  // transação, então reimportar o mesmo arquivo não duplica nem deixa
  // importação pela metade se algo falhar no meio.
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file || !selectedConta) return;
    setImporting(true);

    try {
      const text = await file.text();
      const isOFX = file.name.toLowerCase().endsWith('.ofx') || file.name.toLowerCase().endsWith('.qfx');
      const parsed = isOFX ? parseOFX(text) : parseCSV(text);

      if (parsed.length === 0) {
        toast.warning('Nenhum lançamento reconhecido no arquivo.');
        return;
      }

      const res = await fetch('/api/conciliacao/importar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conta_bancaria_id: selectedConta,
          arquivo_origem: file.name,
          linhas: parsed,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Falha ao importar o extrato.');

      const inseridas = Number(body?.inseridas) || 0;
      const duplicadas = Number(body?.duplicadas) || 0;
      toast.success(
        `${inseridas} lançamento(s) importado(s)`,
        duplicadas > 0 ? `${duplicadas} já existiam na conta e foram ignorados` : undefined,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao importar o extrato.');
    } finally {
      setImporting(false);
      // Reset input
      input.value = '';
      load();
    }
  }

  // Lançamentos já amarrados a alguma linha CONCILIADA do extrato (de qualquer
  // conta): não podem ser oferecidos de novo, senão a mesma CR/CP é baixada
  // duas vezes por duas linhas diferentes.
  const idsJaConciliados = useMemo(() => {
    const ids = new Set<string>();
    for (const e of extrato) {
      if (e.status_conciliacao === 'CONCILIADO' && e.lancamento_vinculado_id) {
        ids.add(e.lancamento_vinculado_id);
      }
    }
    return ids;
  }, [extrato]);

  // Auto-match: find lancamentos that could match an extrato line
  function findMatches(line: ExtratoLinha) {
    const tolerance = 0.01;
    const absVal = Math.abs(line.valor);

    if (line.tipo === 'CREDITO') {
      return contasReceber
        .filter(cr =>
          Math.abs(cr.valor_final - absVal) <= tolerance &&
          cr.status !== 'CANCELADO' &&
          cr.status !== 'RECEBIDO' &&
          !idsJaConciliados.has(cr.id))
        .map(cr => ({ id: cr.id, tipo: 'CONTA_RECEBER' as const, desc: `${cr.cliente_nome} — ${cr.descricao}`, valor: cr.valor_final, data: cr.data_vencimento }));
    } else {
      return contasPagar
        .filter(cp =>
          Math.abs(cp.valor_final - absVal) <= tolerance &&
          cp.status !== 'CANCELADO' &&
          cp.status !== 'PAGO' &&
          !idsJaConciliados.has(cp.id))
        .map(cp => ({ id: cp.id, tipo: 'CONTA_PAGAR' as const, desc: `${cp.fornecedor_nome} — ${cp.descricao}`, valor: cp.valor_final, data: cp.data_vencimento }));
    }
  }

  async function handleConciliar(line: ExtratoLinha, lancId: string, lancTipo: 'CONTA_RECEBER' | 'CONTA_PAGAR' | 'TRANSFERENCIA') {
    if (conciliando) return;
    setConciliando(true);
    const valorBaixa = round2(Math.abs(line.valor));

    try {
      await putJSON<ExtratoLinha>(`/api/extrato-bancario/${line.id}`, {
        ...line,
        status_conciliacao: 'CONCILIADO',
        lancamento_vinculado_id: lancId,
        lancamento_vinculado_tipo: lancTipo,
      });

      // Baixa da CR/CP: relê o registro do servidor e aplica SÓ os campos da
      // baixa por cima. Usar o objeto que está no estado da tela reverteria
      // qualquer edição feita por outro usuário desde o último load().
      try {
        if (lancTipo === 'CONTA_RECEBER') {
          const atual = await getJSON<ContaReceber>(`/api/contas-receber/${lancId}`);
          await putJSON<ContaReceber>(`/api/contas-receber/${lancId}`, {
            ...atual,
            status: 'RECEBIDO',
            data_recebimento: line.data,
            valor_recebido: valorBaixa,
            conta_bancaria_id: line.conta_bancaria_id,
          });
        } else if (lancTipo === 'CONTA_PAGAR') {
          const atual = await getJSON<ContaPagar>(`/api/contas-pagar/${lancId}`);
          await putJSON<ContaPagar>(`/api/contas-pagar/${lancId}`, {
            ...atual,
            status: 'PAGO',
            data_pagamento: line.data,
            valor_pago: valorBaixa,
            conta_bancaria_id: line.conta_bancaria_id,
          });
        }
      } catch (err) {
        // Baixa falhou: devolve a linha do extrato ao estado anterior para não
        // deixar um "CONCILIADO" apontando para lançamento que não baixou.
        await putJSON<ExtratoLinha>(`/api/extrato-bancario/${line.id}`, line).catch(() => {});
        throw err;
      }

      toast.success('Lançamento conciliado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível conciliar o lançamento.');
    } finally {
      setConciliando(false);
      setConciliarItem(null);
      load();
    }
  }

  async function marcarStatus(line: ExtratoLinha, status: StatusConciliacao) {
    try {
      await putJSON<ExtratoLinha>(`/api/extrato-bancario/${line.id}`, { ...line, status_conciliacao: status });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar a linha do extrato.');
    } finally {
      setConciliarItem(null);
      load();
    }
  }

  async function handleIgnorar(line: ExtratoLinha) {
    await marcarStatus(line, 'IGNORADO');
  }

  async function handleDivergente(line: ExtratoLinha) {
    await marcarStatus(line, 'DIVERGENTE');
  }

  const contaExtrato = extrato.filter(e => e.conta_bancaria_id === selectedConta);
  const filtered = contaExtrato.filter(e => {
    if (filterStatus !== 'TODOS' && e.status_conciliacao !== filterStatus) return false;
    if (searchTerm && !e.descricao.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  }).sort((a, b) => b.data.localeCompare(a.data));

  const stats = useMemo(() => {
    const total = contaExtrato.length;
    const conciliados = contaExtrato.filter(e => e.status_conciliacao === 'CONCILIADO').length;
    const linhasPendentes = contaExtrato.filter(e => e.status_conciliacao === 'PENDENTE');
    const pendentes = linhasPendentes.length;
    const divergentes = contaExtrato.filter(e => e.status_conciliacao === 'DIVERGENTE').length;
    return {
      total,
      conciliados,
      pendentes,
      divergentes,
      pct: Math.round(divSegura(conciliados, total) * 100),
      // Soma de apresentação: quanto do extrato ainda não tem par no sistema.
      semPar: somaPor(linhasPendentes, e => Math.abs(e.valor)),
    };
  }, [contaExtrato]);

  // Enquanto carrega, a tela inteira vira esqueleto: nenhuma contagem e nenhum
  // valor são pintados antes de os dados chegarem.
  const estadoDados: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : 'ok';

  const contaSelecionada = contas.find(c => c.id === selectedConta) ?? null;
  const filtrosAtivos = (filterStatus !== 'TODOS' ? 1 : 0) + (searchTerm.trim() ? 1 : 0);

  function limparFiltros() {
    setFilterStatus('TODOS');
    setSearchTerm('');
  }

  function abrirSeletorDeArquivo() {
    inputArquivoRef.current?.click();
  }

  function conferirAgora(linha: ExtratoLinha) {
    setAdiadas(prev => {
      if (!prev.has(linha.id)) return prev;
      const proximo = new Set(prev);
      proximo.delete(linha.id);
      return proximo;
    });
    setConciliarItem(linha);
  }

  function adiarLinha(linha: ExtratoLinha) {
    setAdiadas(prev => new Set(prev).add(linha.id));
    setConciliarItem(null);
  }

  // Fila de decisão: a linha escolhida à mão, senão a primeira ainda não
  // conferida do recorte visível que não foi deixada para depois.
  const fila = filtered.filter(e => e.status_conciliacao === 'PENDENTE');
  const filaAtiva = fila.filter(e => !adiadas.has(e.id));
  const itemFila = conciliarItem
    ? contaExtrato.find(e => e.id === conciliarItem.id) ?? null
    : filaAtiva[0] ?? null;
  const posicaoNaFila = itemFila ? filaAtiva.findIndex(e => e.id === itemFila.id) + 1 : 0;
  const sugestoes = itemFila ? findMatches(itemFila) : [];

  async function confirmarAcao() {
    if (!acaoPendente || confirmando) return;
    const pendente = acaoPendente;
    setConfirmando(true);
    try {
      if (pendente.tipo === 'conciliar') {
        await handleConciliar(pendente.linha, pendente.lancId, pendente.lancTipo);
      } else if (pendente.tipo === 'ignorar') {
        await handleIgnorar(pendente.linha);
      } else {
        await handleDivergente(pendente.linha);
      }
    } finally {
      setConfirmando(false);
      setAcaoPendente(null);
    }
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
        linha.status_conciliacao === 'PENDENTE' ? (
          <Button
            type="button"
            variant="ghost"
            className={BOTAO_LINHA}
            onClick={() => conferirAgora(linha)}
          >
            <Link2 aria-hidden="true" className="size-4" />
            Conferir
          </Button>
        ) : linha.status_conciliacao === 'CONCILIADO' ? (
          <span className="fin-t-caption inline-flex items-center gap-[var(--fin-s-1)] text-[var(--fin-positive)]">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            Conferido
          </span>
        ) : null,
    },
  ];

  const vazioTabela: EmptyLessonProps = filtrosAtivos > 0
    ? {
        motivo: 'sem-resultado',
        titulo: 'Nenhuma linha com esses filtros',
        oQueE: 'A conta tem lançamentos importados, mas nenhum deles atende à busca e à situação escolhidas.',
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

  // O esqueleto tem a forma do conteúdo real: barra de filtros, bloco de
  // progresso, cartão da fila e tabela.
  const esqueletoTela = (
    <div className="flex flex-col gap-[var(--fin-s-5)]">
      <div className={`${CARTAO} h-12 w-full`} />
      <div className={`${CARTAO} flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`}>
        <span className="block h-[11px] w-40 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
        <Money valor={null} size="metric" align="esquerda" estado="carregando" />
        <span className="block h-1 w-full rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
        <span className="block h-[12px] w-72 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
      </div>
      <div className={`${CARTAO} flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`}>
        <span className="block h-[16px] w-64 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
        <span className="block h-[44px] w-full rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
        <span className="block h-[44px] w-full rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" />
      </div>
      <FinTable
        linhas={[]}
        colunas={colunas}
        chave={linha => linha.id}
        estado="carregando"
        vazio={vazioTabela}
      />
    </div>
  );

  const detalhesDaLinha = (linha: ExtratoLinha) => [
    { rotulo: 'Linha do extrato', valor: linha.descricao },
    { rotulo: 'Data', valor: formatDate(linha.data) },
    { rotulo: 'Valor no extrato', valor: <Money valor={linha.valor} size="strong" estado="ok" /> },
  ];

  return (
    <div className="min-h-full bg-[var(--fin-bg)] px-[var(--fin-page-pad)] py-[var(--fin-s-5)] text-[var(--fin-text)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-6)]">

        <PageHeader
          titulo="Conciliação bancária"
          subtitulo="Confira as linhas do extrato do banco com os lançamentos do sistema, uma a uma."
          acaoPrimaria={
            selectedConta
              ? {
                  rotulo: importing ? 'Importando o arquivo' : 'Importar extrato',
                  icone: Upload,
                  onClick: abrirSeletorDeArquivo,
                }
              : undefined
          }
          onRecarregar={load}
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
                busca={{
                  valor: searchTerm,
                  onChange: setSearchTerm,
                  placeholder: 'Buscar na descrição do extrato',
                }}
                selects={[
                  {
                    id: 'conta-bancaria',
                    rotulo: 'Conta',
                    valor: selectedConta,
                    opcoes: contas.map(c => ({ valor: c.id, rotulo: c.nome })),
                    onChange: setSelectedConta,
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
                resumo={{
                  exibidos: filtered.length,
                  total: contaExtrato.length,
                  substantivo: 'linhas do extrato',
                }}
                ativos={filtrosAtivos}
                onLimpar={limparFiltros}
              />

              {/* Progresso da conta */}
              <section className={`${CARTAO} flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`}>
                <h2 className="fin-t-overline text-[var(--fin-text-3)]">
                  Ainda sem par no sistema
                </h2>
                <Money
                  valor={stats.semPar}
                  size="metric"
                  align="esquerda"
                  estado="ok"
                  aria-label="Valor do extrato ainda sem lançamento correspondente"
                />
                <div
                  role="progressbar"
                  aria-label="Linhas do extrato já conferidas"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={stats.pct}
                  aria-valuetext={`${stats.pct}% do extrato conferido`}
                  className="h-1 w-full overflow-hidden rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]"
                >
                  <div
                    className="h-full w-[var(--fin-meter)] rounded-[var(--fin-r-sm)] bg-[var(--fin-accent)]"
                    style={estiloBarra(stats.pct)}
                  />
                </div>
                <p className="fin-t-caption text-[var(--fin-text-2)]">
                  {stats.conciliados} de {stats.total}{' '}
                  {stats.total === 1 ? 'linha conferida' : 'linhas conferidas'}
                  {contaSelecionada ? ` em ${contaSelecionada.nome}` : ''}
                  {stats.divergentes > 0
                    ? `. ${contarLinhas(stats.divergentes)} ${stats.divergentes === 1 ? 'está marcada' : 'estão marcadas'} como divergente.`
                    : '.'}
                </p>
              </section>

              {/* Fila de conferência */}
              {itemFila ? (
                <section
                  className={`${CARTAO} flex flex-col`}
                  aria-label="Próxima linha do extrato a conferir"
                >
                  <header className="flex flex-col gap-[var(--fin-s-3)] border-b border-[var(--fin-border)] p-[var(--fin-s-4)]">
                    <div className="flex flex-wrap items-center justify-between gap-[var(--fin-s-2)]">
                      <h2 className="fin-t-overline text-[var(--fin-text-3)]">A conferir agora</h2>
                      <span className="fin-t-caption text-[var(--fin-text-3)]" aria-live="polite">
                        {posicaoNaFila > 0
                          ? `${posicaoNaFila} de ${filaAtiva.length} na fila`
                          : 'Linha escolhida na lista'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-[var(--fin-s-3)]">
                      <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
                        <p className="fin-t-subhead text-[var(--fin-text)]">{itemFila.descricao}</p>
                        <p className="fin-t-caption text-[var(--fin-text-3)]">
                          {formatDate(itemFila.data)}
                          {', '}
                          {itemFila.tipo === 'CREDITO' ? 'entrada na conta' : 'saída da conta'}
                        </p>
                      </div>
                      <Money valor={itemFila.valor} size="metricSm" estado="ok" />
                    </div>
                  </header>

                  <div className="flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)]">
                    <h3 className="fin-t-overline text-[var(--fin-text-3)]">
                      Lançamentos com o mesmo valor
                    </h3>

                    {sugestoes.length === 0 ? (
                      <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)]">
                        <p className="fin-t-body-strong text-[var(--fin-text)]">
                          Nenhum lançamento em aberto com este valor
                        </p>
                        <p className="fin-t-caption text-[var(--fin-text-2)]">
                          Procure a conta a {itemFila.tipo === 'CREDITO' ? 'receber' : 'pagar'} na
                          tela de origem e ajuste o valor, ou marque a linha como divergente para
                          resolver depois. Lançamentos cancelados, já baixados e já usados em outra
                          linha do extrato não são oferecidos aqui.
                        </p>
                      </div>
                    ) : (
                      <ul className="flex flex-col gap-[var(--fin-s-2)]">
                        {sugestoes.map(m => {
                          const { titulo, complemento } = partirDescricao(m.desc);
                          return (
                            <li
                              key={m.id}
                              className="flex flex-wrap items-center justify-between gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-3)]"
                            >
                              <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
                                <span className="fin-t-body-strong text-[var(--fin-text)]">{titulo}</span>
                                <span className="fin-t-caption text-[var(--fin-text-3)]">
                                  {complemento ? `${complemento}. ` : ''}
                                  Vence em {formatDate(m.data)}
                                  {', '}
                                  {m.tipo === 'CONTA_RECEBER' ? 'conta a receber' : 'conta a pagar'}
                                </span>
                              </div>
                              <div className="flex items-center gap-[var(--fin-s-3)]">
                                <Money valor={m.valor} size="strong" estado="ok" />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className={BOTAO_LINHA}
                                  disabled={conciliando}
                                  onClick={() =>
                                    setAcaoPendente({
                                      tipo: 'conciliar',
                                      linha: itemFila,
                                      lancId: m.id,
                                      lancTipo: m.tipo,
                                      lancDesc: m.desc,
                                      lancValor: m.valor,
                                    })
                                  }
                                >
                                  É esta
                                </Button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <div className="flex flex-wrap gap-[var(--fin-s-2)]">
                      <Button
                        type="button"
                        variant="ghost"
                        className={BOTAO_SECUNDARIO}
                        disabled={conciliando}
                        onClick={() => setAcaoPendente({ tipo: 'divergente', linha: itemFila })}
                      >
                        Não é nenhuma delas
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className={BOTAO_DISCRETO}
                        disabled={conciliando}
                        onClick={() => setAcaoPendente({ tipo: 'ignorar', linha: itemFila })}
                      >
                        Ignorar esta linha
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className={BOTAO_DISCRETO}
                        disabled={conciliando}
                        onClick={() => adiarLinha(itemFila)}
                      >
                        Deixar para depois
                      </Button>
                    </div>
                  </div>
                </section>
              ) : contaExtrato.length === 0 ? null : adiadas.size > 0 && fila.length > 0 ? (
                <EmptyLesson
                  motivo="sem-resultado"
                  titulo="A fila está vazia por enquanto"
                  oQueE={`${contarLinhas(fila.length)} do extrato ${fila.length === 1 ? 'foi deixada' : 'foram deixadas'} para depois. Retome a fila quando quiser continuar a conferência.`}
                  acaoSecundaria={{ rotulo: 'Retomar linhas adiadas', onClick: () => setAdiadas(new Set()) }}
                />
              ) : stats.pendentes > 0 ? (
                <EmptyLesson
                  motivo="sem-resultado"
                  titulo="As linhas a conferir estão fora do filtro"
                  oQueE={`Esta conta ainda tem ${contarLinhas(stats.pendentes)} a conferir, mas o recorte escolhido na barra de filtros não mostra nenhuma delas.`}
                  acaoSecundaria={{ rotulo: 'Limpar filtros', onClick: limparFiltros }}
                />
              ) : (
                <section
                  className={`${CARTAO} flex items-start gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]"
                  >
                    <CheckCircle2 className="size-5" />
                  </span>
                  <div className="flex flex-col gap-[var(--fin-s-1)]">
                    <h2 className="fin-t-subhead text-[var(--fin-text)]">
                      Nada para conferir nesta conta
                    </h2>
                    <p className="fin-t-caption text-[var(--fin-text-2)]">
                      Todas as linhas importadas já foram conferidas, ignoradas ou marcadas como
                      divergentes. Importe um extrato novo para continuar.
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
                />
              </section>

              {/* Importação */}
              <section
                className={`${CARTAO} flex flex-col items-start gap-[var(--fin-s-3)] p-[var(--fin-s-4)]`}
                aria-label="Importar extrato"
              >
                <h2 className="fin-t-overline text-[var(--fin-text-3)]">Importar extrato</h2>
                <div className="flex w-full flex-col items-center gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-dashed border-[var(--fin-border-strong)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-5)] text-center">
                  <span
                    aria-hidden="true"
                    className="grid size-10 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]"
                  >
                    <FileSpreadsheet className="size-5" />
                  </span>
                  <p className="fin-t-body-strong text-[var(--fin-text)]" aria-live="polite">
                    {importing
                      ? 'Lendo o arquivo e enviando para o servidor'
                      : contaExtrato.length === 0
                        ? 'Nenhum arquivo importado nesta conta ainda'
                        : `${contarLinhas(stats.total)} no extrato desta conta, ${stats.pendentes} ainda a conferir`}
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
                  <Button
                    type="button"
                    variant="ghost"
                    className={BOTAO_SECUNDARIO}
                    disabled={importing || !selectedConta}
                    onClick={abrirSeletorDeArquivo}
                  >
                    <Upload aria-hidden="true" className="size-4" />
                    Escolher arquivo
                  </Button>
                </div>
              </section>
            </div>
          )}
        </DataState>
      </div>

      <ConfirmDialog
        aberto={acaoPendente !== null}
        onOpenChange={aberto => {
          if (!aberto) setAcaoPendente(null);
        }}
        titulo={
          acaoPendente?.tipo === 'conciliar'
            ? 'Conciliar esta linha do extrato'
            : acaoPendente?.tipo === 'ignorar'
              ? 'Ignorar esta linha do extrato'
              : 'Marcar como divergente'
        }
        oQueVaiAcontecer={
          acaoPendente?.tipo === 'conciliar'
            ? acaoPendente.lancTipo === 'CONTA_RECEBER'
              ? 'A linha do extrato fica conciliada e a conta a receber é marcada como recebida, com a data e o valor do extrato.'
              : 'A linha do extrato fica conciliada e a conta a pagar é marcada como paga, com a data e o valor do extrato.'
            : acaoPendente?.tipo === 'ignorar'
              ? 'A linha sai da fila de conferência e passa a aparecer como ignorada. Nenhum lançamento é baixado.'
              : 'A linha fica marcada como divergente para você resolver depois. Nenhum lançamento é baixado.'
        }
        detalhes={
          acaoPendente
            ? acaoPendente.tipo === 'conciliar'
              ? [
                  ...detalhesDaLinha(acaoPendente.linha),
                  {
                    rotulo:
                      acaoPendente.lancTipo === 'CONTA_RECEBER' ? 'Conta a receber' : 'Conta a pagar',
                    valor: descricaoLegivel(acaoPendente.lancDesc),
                  },
                  {
                    rotulo: 'Valor do lançamento',
                    valor: <Money valor={acaoPendente.lancValor} size="strong" estado="ok" />,
                  },
                ]
              : detalhesDaLinha(acaoPendente.linha)
            : undefined
        }
        previa={
          acaoPendente?.tipo === 'conciliar' ? (
            <>
              {acaoPendente.lancTipo === 'CONTA_RECEBER' ? 'Recebimento' : 'Pagamento'} de{' '}
              <Money
                valor={round2(Math.abs(acaoPendente.linha.valor))}
                size="body"
                align="esquerda"
                estado="ok"
                className="min-w-0"
              />{' '}
              lançado em {formatDate(acaoPendente.linha.data)}
              {contaSelecionada ? `, na conta ${contaSelecionada.nome}` : ''}.
            </>
          ) : undefined
        }
        confirmarRotulo={
          acaoPendente?.tipo === 'conciliar'
            ? 'Conciliar'
            : acaoPendente?.tipo === 'ignorar'
              ? 'Ignorar linha'
              : 'Marcar divergente'
        }
        tone={acaoPendente?.tipo === 'ignorar' ? 'destrutivo' : 'padrao'}
        processando={confirmando || conciliando}
        onConfirmar={confirmarAcao}
      />
    </div>
  );
}
