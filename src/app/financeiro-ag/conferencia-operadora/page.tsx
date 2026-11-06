'use client';

/**
 * Conferência de operadora (E6, 05/11/2026).
 *
 * A agência solta o extrato que a operadora ou a consolidadora mandou (PDF,
 * foto, planilha, CSV ou o texto do e-mail). A IA da agência lê; o sistema
 * confere a soma e as datas, casa cada linha com a venda pelo localizador e
 * mostra Conferido, Divergente (com a diferença explicada) ou Não encontrado.
 * Cancelamento que a operadora registrou e a venda não tem é só PROPOSTO.
 * No fim, "Fechar conferência" trava o período.
 *
 * Uma tela só: a lista e, com ?id=, a conferência aberta.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, CircleSlash, FileSearch, Link2, Lock, LockOpen, RefreshCw, Search, Upload, X,
} from 'lucide-react';

import type { FornecedorCRM } from '@/lib/crm-types';
import type { ComissaoDaOperadora, Diferenca, Situacao, TipoDeLinha } from '@/lib/conferencia-operadora';
import { ROTULO_DO_TIPO } from '@/lib/conferencia-operadora';
import { loadEntities } from '@/lib/crm-storage';
import { cn, formatBRL, formatDate } from '@/lib/utils';
import { toast } from '@/lib/toast';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Callout } from '@/components/fin/Callout';
import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { StatusChip } from '@/components/fin/StatusChip';

// ── Tipos que a API devolve ────────────────────────────────────────────────

interface Contagem { CONFERIDO: number; DIVERGENTE: number; NAO_ENCONTRADO: number; resolvidas: number; total: number; propostas: number }
interface Conferencia {
  id: string; arquivo_nome: string; origem: string; fornecedor_id: string; fornecedor_nome: string;
  periodo_de: string | null; periodo_ate: string | null; status: 'ABERTA' | 'FECHADA';
  total_liquido_centavos: number | null; soma_liquido_centavos: number; avisos: string[];
  criada_em: string; criada_por_nome: string | null; fechada_em: string | null; fechada_por: string | null; reaberta_motivo: string | null;
  contagem: Contagem;
}
interface Linha {
  id: string; ordem: number; data: string | null; localizador: string; passageiro: string; descricao: string; tipo: TipoDeLinha;
  bruto_centavos: number | null; taxas_centavos: number | null; comissao_centavos: number | null; liquido_centavos: number | null;
  valido: boolean; motivos_invalida: string[]; situacao: Situacao; como_casou: string; ambiguos: number;
  venda_id: string; venda_numero: string; item_id: string; diferencas: Diferenca[];
  comissao_esperada_centavos: number; comissao_recebida_centavos: number;
  proposta: { texto: string; venda_id: string; venda_numero: string } | null;
  proposta_status: 'proposta' | 'descartada' | 'resolvida' | null;
  aceita_motivo: string | null; aceita_por: string | null; resolvida: boolean;
}
interface Detalhe { conferencia: Conferencia; linhas: Linha[]; fechar: { ok: boolean; motivos: string[] }; comissao: ComissaoDaOperadora | null }
interface Previa {
  hash: string; origem: string; arquivo_nome: string; repetida: boolean;
  extrato: { operadora_nome: string; operadora_cnpj: string; periodo_de: string | null; periodo_ate: string | null; total_linhas: number };
  operadora_sugerida: { id: string; nome: string } | null;
  previa: {
    checagem: { avisos: string[]; soma_confere: boolean | null };
    resumo: { CONFERIDO: number; DIVERGENTE: number; NAO_ENCONTRADO: number; invalidas: number; propostas: number };
    linhas: Array<{ ordem: number; data: string | null; localizador: string; passageiro: string; tipo: TipoDeLinha; liquido_centavos: number | null; bruto_centavos: number | null; valido: boolean; situacao: Situacao; venda_numero: string; diferencas: Diferenca[] }>;
  };
  ja_conferido: { id: string; status: string } | null;
}
interface ItemBuscado { item_id: string; venda_numero: string; descricao: string; localizador: string; data_venda: string; fornecedor_nome: string }

// ── Estilo ─────────────────────────────────────────────────────────────────

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
const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';

const reais = (c: number | null | undefined) => (c === null || c === undefined ? null : c / 100);
const periodo = (de: string | null, ate: string | null) =>
  de && ate ? `${formatDate(de)} a ${formatDate(ate)}` : de ? `desde ${formatDate(de)}` : ate ? `até ${formatDate(ate)}` : 'período não informado';
const cobrado = (l: { liquido_centavos: number | null; bruto_centavos: number | null }) => reais(l.liquido_centavos ?? l.bruto_centavos);

async function enviar<T>(url: string, init: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || 'Não foi possível concluir.');
  return j as T;
}
const postarJson = <T,>(url: string, corpo: unknown) =>
  enviar<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });

/** O que a tela mostra como situação da linha: a decisão da pessoa vence a automática. */
function situacaoNaTela(l: Linha): string {
  if (l.proposta_status === 'proposta') return 'PROPOSTA';
  if (l.aceita_motivo) return 'ACEITO';
  return l.situacao;
}

const SEM_CADASTRO = '__sem_cadastro__';

type Filtro = 'todas' | 'resolver' | 'DIVERGENTE' | 'NAO_ENCONTRADO' | 'propostas';

// ── Página ────────────────────────────────────────────────────────────────

export default function ConferenciaOperadoraPage() {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    const ler = () => setId(new URLSearchParams(window.location.search).get('id'));
    ler();
    window.addEventListener('popstate', ler);
    return () => window.removeEventListener('popstate', ler);
  }, []);

  const abrir = useCallback((novo: string | null) => {
    router.push(novo ? `/financeiro-ag/conferencia-operadora?id=${encodeURIComponent(novo)}` : '/financeiro-ag/conferencia-operadora');
    setId(novo);
  }, [router]);

  return id ? <DetalheDaConferencia id={id} onVoltar={() => abrir(null)} /> : <ListaDeConferencias onAbrir={abrir} />;
}

// ── Lista ─────────────────────────────────────────────────────────────────

function ListaDeConferencias({ onAbrir }: { onAbrir: (id: string) => void }) {
  const [dados, setDados] = useState<{ conferencias: Conferencia[]; comissao: ComissaoDaOperadora[] | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await enviar('/api/conferencia-operadora', {}));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const abertas = (dados?.conferencias ?? []).filter(c => c.status === 'ABERTA');
  const aResolver = abertas.reduce((a, c) => a + (c.contagem.total - c.contagem.resolvidas), 0);
  const difComissao = (dados?.comissao ?? []).reduce((a, c) => a + c.diferenca_informada_centavos, 0);

  const colunas: FinColuna<Conferencia>[] = [
    {
      id: 'operadora', cabecalho: 'Operadora', tipo: 'texto', sortable: true, acessor: c => c.fornecedor_nome,
      render: c => (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{c.fornecedor_nome}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{c.arquivo_nome}</span>
        </span>
      ),
    },
    { id: 'periodo', cabecalho: 'Período', tipo: 'texto', sortable: true, acessor: c => c.periodo_de ?? '', render: c => <span className="fin-t-body tabular-nums">{periodo(c.periodo_de, c.periodo_ate)}</span> },
    {
      id: 'andamento', cabecalho: 'Conferidas', tipo: 'texto', sortable: true, acessor: c => c.contagem.resolvidas / Math.max(1, c.contagem.total),
      render: c => (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body tabular-nums">{c.contagem.resolvidas} de {c.contagem.total}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {[c.contagem.DIVERGENTE ? `${c.contagem.DIVERGENTE} divergentes` : '', c.contagem.NAO_ENCONTRADO ? `${c.contagem.NAO_ENCONTRADO} não encontradas` : '', c.contagem.propostas ? `${c.contagem.propostas} cancelamentos a decidir` : '']
              .filter(Boolean).join(', ') || 'tudo conferido'}
          </span>
        </span>
      ),
    },
    { id: 'total', cabecalho: 'Líquido do extrato', tipo: 'dinheiro', sortable: true, valor: c => (c.total_liquido_centavos ?? c.soma_liquido_centavos) / 100 },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', sortable: true, dominio: 'conferencia', valor: c => c.status },
  ];

  const colComissao: FinColuna<ComissaoDaOperadora>[] = [
    { id: 'operadora', cabecalho: 'Operadora', tipo: 'texto', sortable: true, acessor: c => c.operadora, render: c => <span className="fin-t-body-strong">{c.operadora}</span> },
    { id: 'esperada', cabecalho: 'Esperada pelas vendas', tipo: 'dinheiro', sortable: true, valor: c => c.esperada_centavos / 100 },
    {
      id: 'informada', cabecalho: 'Informada pela operadora', tipo: 'dinheiro', sortable: true, valor: c => c.informada_centavos / 100,
      sub: c => c.diferenca_informada_centavos === 0 ? null : (
        <span className={c.diferenca_informada_centavos < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]'}>
          {c.diferenca_informada_centavos < 0 ? `${formatBRL(-c.diferenca_informada_centavos / 100)} a menos` : `${formatBRL(c.diferenca_informada_centavos / 100)} a mais`}
        </span>
      ),
    },
    { id: 'recebida', cabecalho: 'Recebida no financeiro', tipo: 'dinheiro', sortable: true, valor: c => c.recebida_centavos / 100, sub: c => (c.a_receber_centavos > 0 ? `falta receber ${formatBRL(c.a_receber_centavos / 100)}` : null) },
  ];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={FileSearch}
        titulo="Conferência de operadora"
        subtitulo="Solte o extrato que a operadora mandou: cada linha é casada com a venda pelo localizador e a diferença vem explicada. Cancelamento é só proposto, nunca aplicado."
        acaoPrimaria={{ rotulo: 'Conferir extrato', icone: Upload, onClick: () => setLendo(true) }}
        onRecarregar={carregar}
      />
      <DataState
        estado={erro ? 'erro' : dados ? 'ok' : 'carregando'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => void carregar() } : null}
        esqueleto={<FinTable linhas={[]} colunas={colunas} chave={c => c.id} estado="carregando" vazio={{ motivo: 'sem-dado', titulo: '', oQueE: '' }} />}
      >
        <div className={RITMO_DA_PAGINA}>
          <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard rotulo="Conferências abertas" icone={LockOpen} formato="contagem" valor={abertas.length} estado="ok"
              contexto={`de ${(dados?.conferencias.length ?? 0).toLocaleString('pt-BR')} no total`} />
            <MetricCard rotulo="Linhas a resolver" icone={AlertTriangle} formato="contagem" valor={aResolver} estado="ok"
              tone={aResolver > 0 ? 'negativo' : 'neutro'} contexto="divergentes, não encontradas e cancelamentos a decidir" />
            {dados?.comissao ? (
              <MetricCard rotulo="Comissão informada × esperada" valor={difComissao / 100} estado="ok" tomDoIcone="violeta"
                tone={difComissao < 0 ? 'negativo' : 'neutro'} contexto={difComissao < 0 ? 'as operadoras informaram menos do que as vendas esperam' : 'nas conferências do período'} />
            ) : null}
          </div>

          <section aria-label="Conferências" className="flex flex-col gap-[var(--fin-s-3)]">
            <h2 className="fin-t-subhead text-[var(--fin-text)]">Extratos conferidos</h2>
            <FinTable linhas={dados?.conferencias ?? []} colunas={colunas} chave={c => c.id} estado="ok" onLinhaClick={c => onAbrir(c.id)}
              vazio={{
                motivo: 'sem-dado', titulo: 'Nenhum extrato conferido ainda',
                oQueE: 'Aqui ficam os extratos das operadoras e consolidadoras, conferidos linha a linha com as vendas.',
                comoComeca: [
                  'Baixe o extrato do período no portal da operadora (PDF, planilha ou CSV), ou copie o texto do e-mail.',
                  'Clique em Conferir extrato e solte o arquivo.',
                  'Confira a prévia, escolha a operadora e abra a conferência.',
                ],
                acao: { rotulo: 'Conferir extrato', onClick: () => setLendo(true) },
              }} />
          </section>

          {dados?.comissao && dados.comissao.length > 0 ? (
            <section aria-label="Comissão por operadora" className="flex flex-col gap-[var(--fin-s-3)]">
              <h2 className="fin-t-subhead text-[var(--fin-text)]">Comissão esperada × recebida, por operadora</h2>
              <FinTable linhas={dados.comissao} colunas={colComissao} chave={c => c.operadora} estado="ok" densidade="compacta"
                vazio={{ motivo: 'sem-dado', titulo: '', oQueE: '' }} />
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                Esperada: o que as vendas casadas preveem. Informada: o que a operadora pôs no extrato. Recebida: o que já entrou nas contas de comissão quando o cliente pagou direto à operadora.
              </p>
            </section>
          ) : null}
        </div>
      </DataState>

      <LeituraDoExtrato aberto={lendo} onFechar={() => setLendo(false)} onCriada={idNovo => { setLendo(false); onAbrir(idNovo); }} />
    </MolduraDaPagina>
  );
}

// ── Ler e confirmar ───────────────────────────────────────────────────────

function LeituraDoExtrato({ aberto, onFechar, onCriada }: { aberto: boolean; onFechar: () => void; onCriada: (id: string) => void }) {
  const [modo, setModo] = useState<'arquivo' | 'email'>('arquivo');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [texto, setTexto] = useState('');
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [fornecedores, setFornecedores] = useState<FornecedorCRM[]>([]);
  const [fornecedorId, setFornecedorId] = useState('');
  const [nomeOperadora, setNomeOperadora] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [gravando, setGravando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberto) return;
    setModo('arquivo'); setArquivo(null); setTexto(''); setErro(null); setPrevia(null); setFornecedorId(''); setNomeOperadora(''); setDe(''); setAte('');
    void loadEntities<FornecedorCRM>('fornecedores-crm').then(setFornecedores).catch(() => {});
  }, [aberto]);

  async function ler() {
    setLendo(true);
    setErro(null);
    try {
      let p: Previa;
      if (modo === 'arquivo') {
        if (!arquivo) throw new Error('Escolha o arquivo do extrato.');
        const form = new FormData();
        form.append('file', arquivo);
        p = await enviar<Previa>('/api/conferencia-operadora/ler', { method: 'POST', body: form });
      } else {
        p = await postarJson<Previa>('/api/conferencia-operadora/ler', { texto });
      }
      setPrevia(p);
      setFornecedorId(p.operadora_sugerida?.id ?? '');
      setNomeOperadora(p.operadora_sugerida?.nome ?? p.extrato.operadora_nome);
      setDe(p.extrato.periodo_de ?? '');
      setAte(p.extrato.periodo_ate ?? '');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler.');
    } finally {
      setLendo(false);
    }
  }

  async function gravar() {
    if (!previa) return;
    setGravando(true);
    try {
      const nome = fornecedorId ? (fornecedores.find(f => f.id === fornecedorId)?.nome_fantasia || nomeOperadora) : nomeOperadora;
      const r = await postarJson<{ id: string }>('/api/conferencia-operadora', {
        hash: previa.hash, fornecedor_id: fornecedorId, fornecedor_nome: nome, periodo_de: de || null, periodo_ate: ate || null,
      });
      toast.success('Conferência aberta', 'Resolva as linhas divergentes e feche o período quando terminar.');
      onCriada(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível abrir a conferência.');
    } finally {
      setGravando(false);
    }
  }

  const r = previa?.previa.resumo;
  const colPrevia: FinColuna<Previa['previa']['linhas'][number]>[] = [
    { id: 'ordem', cabecalho: 'Nº', tipo: 'texto', render: l => <span className="fin-t-caption tabular-nums">{l.ordem}</span> },
    {
      id: 'loc', cabecalho: 'Reserva', tipo: 'texto',
      render: l => (
        <span className="flex flex-col">
          <span className="fin-t-body-strong tabular-nums">{l.localizador || 'Sem localizador'}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{l.passageiro || ROTULO_DO_TIPO[l.tipo]}</span>
        </span>
      ),
    },
    { id: 'valor', cabecalho: 'Cobrado', tipo: 'dinheiro', valor: l => cobrado(l) ?? 0 },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', dominio: 'conferencia', valor: l => l.situacao },
    { id: 'por', cabecalho: 'Por quê', tipo: 'texto', prioridade: 1, render: l => <span className="fin-t-caption text-[var(--fin-text-2)]">{!l.valido ? 'Linha não fecha ou fora do período' : l.diferencas[0]?.texto ?? (l.venda_numero ? `Venda ${l.venda_numero}` : '')}</span> },
  ];

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={previa ? 'Conferir a leitura' : 'Conferir extrato de operadora'}
      descricao={previa ? `${previa.arquivo_nome}: ${previa.extrato.total_linhas} linhas lidas${previa.repetida ? ' (leitura guardada, sem custo de IA)' : ''}. Nada foi gravado ainda.` : 'A IA da agência lê o extrato; o sistema confere a soma, as datas e casa com as vendas. Nada é gravado antes de você confirmar.'}
      largura={960}
      sujo={!!previa}
      acaoPrimaria={previa
        ? { rotulo: 'Abrir a conferência', onClick: gravar, carregando: gravando, desabilitado: !!previa.ja_conferido || !(fornecedorId || nomeOperadora.trim()) }
        : { rotulo: lendo ? 'Lendo o extrato...' : 'Ler o extrato', onClick: ler, carregando: lendo, desabilitado: modo === 'arquivo' ? !arquivo : texto.trim().length < 20 }}
      acaoSecundaria={previa ? { rotulo: 'Ler outro', onClick: () => setPrevia(null) } : null}
    >
      {!previa ? (
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <Segmentado<'arquivo' | 'email'> rotulo="De onde vem o extrato" valor={modo} onChange={setModo}
            opcoes={[{ valor: 'arquivo', rotulo: 'Arquivo' }, { valor: 'email', rotulo: 'Texto do e-mail' }]} />
          {modo === 'arquivo' ? (
            <div className="flex flex-col items-center gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-dashed border-[var(--fin-border-strong)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-5)] text-center">
              <span aria-hidden="true" className="grid size-10 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]"><Upload className="size-5" /></span>
              <p className="fin-t-body-strong text-[var(--fin-text)]">{arquivo ? arquivo.name : 'PDF, foto, planilha (XLSX, XLS, ODS) ou CSV'}</p>
              <p className="fin-t-caption max-w-[60ch] text-[var(--fin-text-2)]">O mesmo arquivo lido de novo usa a leitura guardada: não paga a IA duas vezes e não vira duas conferências.</p>
              <input ref={entrada} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.ods,.csv,.txt"
                onChange={e => { setArquivo(e.target.files?.[0] ?? null); setErro(null); e.target.value = ''; }} />
              <Button type="button" variant="ghost" className={BOTAO_LINHA} onClick={() => entrada.current?.click()}>
                <Upload aria-hidden="true" className="size-4" /> {arquivo ? 'Trocar arquivo' : 'Escolher arquivo'}
              </Button>
            </div>
          ) : (
            <Field rotulo="Texto do e-mail da operadora" ajuda="Copie e cole o corpo do e-mail com as reservas, valores e comissões.">
              {a => <Textarea {...a} rows={10} className="fin-t-body min-h-48 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)]" value={texto} onChange={e => setTexto(e.target.value)} />}
            </Field>
          )}
          {erro ? <Callout tom="negativo" titulo="Não deu para ler">{erro}</Callout> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          {previa.ja_conferido ? (
            <Callout tom="aviso" titulo="Este arquivo já foi conferido">
              Abra a conferência que existe em vez de criar outra. <Link className="text-[var(--fin-accent)] underline underline-offset-2" href={`/financeiro-ag/conferencia-operadora?id=${previa.ja_conferido.id}`} onClick={() => onCriada(previa.ja_conferido!.id)}>Abrir a conferência</Link>
            </Callout>
          ) : null}
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-3">
            <Field rotulo="Operadora" obrigatorio ajuda={previa.operadora_sugerida ? 'Achada no cadastro pelo CNPJ ou nome.' : `Lido no extrato: ${previa.extrato.operadora_nome || 'sem nome'}.`}>
              {a => (
                <Select value={fornecedorId || SEM_CADASTRO} onValueChange={v => setFornecedorId(v && v !== SEM_CADASTRO ? String(v) : '')}>
                  <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={cn(CONTROLE, 'justify-between gap-2')}>
                    <SelectValue>{() => fornecedores.find(f => f.id === fornecedorId)?.nome_fantasia || nomeOperadora || 'Escolha'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_CADASTRO} className="fin-t-body">{previa.extrato.operadora_nome ? `Como está no extrato: ${previa.extrato.operadora_nome}` : 'Sem cadastro'}</SelectItem>
                    {fornecedores.map(f => <SelectItem key={f.id} value={f.id} className="fin-t-body">{f.nome_fantasia || f.razao_social}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field rotulo="Período de">{a => <Input {...a} type="date" className={CONTROLE} value={de} onChange={e => setDe(e.target.value)} />}</Field>
            <Field rotulo="até">{a => <Input {...a} type="date" className={CONTROLE} value={ate} onChange={e => setAte(e.target.value)} />}</Field>
          </div>
          {!fornecedorId ? (
            <Field rotulo="Nome da operadora" obrigatorio>{a => <Input {...a} className={CONTROLE} value={nomeOperadora} onChange={e => setNomeOperadora(e.target.value)} />}</Field>
          ) : null}
          {r ? (
            <ul className="flex flex-wrap gap-[var(--fin-s-2)]" aria-label="Resumo da prévia">
              <li><StatusChip dominio="conferencia" valor="CONFERIDO" /> <span className="fin-t-body tabular-nums">{r.CONFERIDO}</span></li>
              <li><StatusChip dominio="conferencia" valor="DIVERGENTE" /> <span className="fin-t-body tabular-nums">{r.DIVERGENTE}</span></li>
              <li><StatusChip dominio="conferencia" valor="NAO_ENCONTRADO" /> <span className="fin-t-body tabular-nums">{r.NAO_ENCONTRADO}</span></li>
              {r.propostas > 0 ? <li className="fin-t-body text-[var(--fin-warning-text)]">{r.propostas} cancelamentos a decidir</li> : null}
              {r.invalidas > 0 ? <li className="fin-t-body text-[var(--fin-negative-text)]">{r.invalidas} linhas não fecham as contas</li> : null}
            </ul>
          ) : null}
          {previa.previa.checagem.avisos.length > 0 ? (
            <Callout tom="aviso" titulo="Confira antes de abrir">{previa.previa.checagem.avisos.join(' ')}</Callout>
          ) : previa.previa.checagem.soma_confere ? (
            <Callout tom="positivo" titulo="A soma bate">A soma das linhas lidas é igual ao total que o documento declara.</Callout>
          ) : null}
          <FinTable linhas={previa.previa.linhas.slice(0, 200)} colunas={colPrevia} chave={l => String(l.ordem)} estado="ok" densidade="compacta"
            vazio={{ motivo: 'sem-dado', titulo: 'Nenhuma linha lida', oQueE: 'O documento não tinha reservas que a leitura reconhecesse. Tente o PDF ou a planilha do portal da operadora.' }} />
        </div>
      )}
    </RecordSheet>
  );
}

// ── Uma conferência ───────────────────────────────────────────────────────

function DetalheDaConferencia({ id, onVoltar }: { id: string; onVoltar: () => void }) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('resolver');
  const [aceitando, setAceitando] = useState<{ linha: Linha; tipo: 'aceitar' | 'descartar_proposta' } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ligando, setLigando] = useState<Linha | null>(null);
  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState<ItemBuscado[]>([]);
  const [fechando, setFechando] = useState(false);
  const [reabrindo, setReabrindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setD(await enviar<Detalhe>(`/api/conferencia-operadora/${encodeURIComponent(id)}`, {}));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
    }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  const agir = useCallback(async (corpo: Record<string, unknown>, sucesso: string) => {
    setOcupado(true);
    try {
      await postarJson(`/api/conferencia-operadora/${encodeURIComponent(id)}`, corpo);
      toast.success(sucesso);
      await carregar();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir.');
      return false;
    } finally {
      setOcupado(false);
    }
  }, [id, carregar]);

  useEffect(() => {
    if (!ligando || termo.trim().length < 2) { setAchados([]); return; }
    const t = setTimeout(() => {
      void enviar<{ itens: ItemBuscado[] }>(`/api/conferencia-operadora?venda=${encodeURIComponent(termo.trim())}`, {})
        .then(r => setAchados(r.itens)).catch(() => setAchados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [termo, ligando]);

  const c = d?.conferencia;
  const fechada = c?.status === 'FECHADA';
  const linhas = useMemo(() => {
    const todas = d?.linhas ?? [];
    switch (filtro) {
      case 'resolver': return todas.filter(l => !l.resolvida);
      case 'DIVERGENTE': return todas.filter(l => l.situacao === 'DIVERGENTE');
      case 'NAO_ENCONTRADO': return todas.filter(l => l.situacao === 'NAO_ENCONTRADO');
      case 'propostas': return todas.filter(l => l.proposta_status === 'proposta' || l.proposta_status === 'descartada' || l.proposta_status === 'resolvida');
      default: return todas;
    }
  }, [d, filtro]);
  const contar = (f: Filtro) => {
    const todas = d?.linhas ?? [];
    if (f === 'resolver') return todas.filter(l => !l.resolvida).length;
    if (f === 'DIVERGENTE' || f === 'NAO_ENCONTRADO') return todas.filter(l => l.situacao === f).length;
    if (f === 'propostas') return todas.filter(l => l.proposta_status).length;
    return todas.length;
  };

  const colunas: FinColuna<Linha>[] = [
    { id: 'ordem', cabecalho: 'Nº', tipo: 'texto', sortable: true, acessor: l => l.ordem, render: l => <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{l.ordem}</span> },
    { id: 'data', cabecalho: 'Data', tipo: 'data', sortable: true, valor: l => l.data },
    {
      id: 'reserva', cabecalho: 'Reserva', tipo: 'texto', sortable: true, acessor: l => l.localizador,
      render: l => (
        <span className="flex flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{l.localizador || 'Sem localizador'}</span>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{[l.passageiro, ROTULO_DO_TIPO[l.tipo]].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    { id: 'cobrado', cabecalho: 'Cobrado', tipo: 'dinheiro', sortable: true, valor: l => cobrado(l) ?? 0, tone: l => (l.tipo === 'cancelamento' || l.tipo === 'reembolso' ? 'positivo' : 'neutro'), sub: l => (l.tipo === 'cancelamento' || l.tipo === 'reembolso' ? 'devolução' : null) },
    { id: 'comissao', cabecalho: 'Comissão', tipo: 'dinheiro', prioridade: 2, valor: l => reais(l.comissao_centavos) ?? 0, sub: l => (l.comissao_esperada_centavos ? `esperada ${formatBRL(l.comissao_esperada_centavos / 100)}` : null) },
    {
      id: 'valido', cabecalho: 'Válido', tipo: 'texto', prioridade: 1, acessor: l => (l.valido ? 1 : 0),
      render: l => l.valido
        ? <span className="inline-flex items-center gap-1 text-[var(--fin-positive)]"><Check aria-hidden="true" className="size-4" /><span className="sr-only">Válido</span></span>
        : <span className="fin-t-caption inline-flex max-w-[28ch] items-start gap-1 text-[var(--fin-negative-text)]"><X aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{l.motivos_invalida[0]}</span>,
    },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', sortable: true, dominio: 'conferencia', valor: situacaoNaTela },
    {
      id: 'porque', cabecalho: 'Venda e diferença', tipo: 'texto',
      render: l => (
        <span className="flex max-w-[48ch] flex-col gap-[var(--fin-s-1)]">
          {l.venda_id ? (
            <Link href={`/vendas/${l.venda_id}`} className="fin-t-body-strong text-[var(--fin-accent)] underline-offset-2 hover:underline">
              Venda {l.venda_numero || ''}{l.como_casou === 'manual' ? ' (ligada à mão)' : l.como_casou === 'passageiro' ? ' (pelo passageiro)' : ''}
            </Link>
          ) : (
            <span className="fin-t-caption text-[var(--fin-text-3)]">{l.ambiguos > 1 ? `${l.ambiguos} vendas com este localizador: escolha a certa.` : 'Nenhuma venda com este localizador.'}</span>
          )}
          {l.diferencas.map((df, i) => <span key={i} className="fin-t-caption text-[var(--fin-text-2)]">{df.texto}</span>)}
          {l.proposta_status === 'proposta' && l.proposta ? <span className="fin-t-caption text-[var(--fin-warning-text)]">Proposta: {l.proposta.texto}</span> : null}
          {l.proposta_status === 'resolvida' ? <span className="fin-t-caption text-[var(--fin-positive)]">A venda já foi cancelada no sistema.</span> : null}
          {l.aceita_motivo ? <span className="fin-t-caption text-[var(--fin-info)]">Aceito{l.aceita_por ? ` por ${l.aceita_por}` : ''}: {l.aceita_motivo}</span> : null}
        </span>
      ),
    },
    {
      id: 'acoes', cabecalho: 'Ação', tipo: 'acoes',
      render: l => fechada ? null : (
        <span className="inline-flex flex-wrap justify-end gap-[var(--fin-s-1)]">
          {l.proposta_status === 'proposta' ? (
            <>
              <Button type="button" variant="ghost" className={BOTAO_LINHA} onClick={() => window.open(`/vendas/${l.proposta!.venda_id}`, '_blank', 'noopener')}>Abrir a venda</Button>
              <Button type="button" variant="ghost" className={BOTAO_DISCRETO} onClick={() => { setMotivo(''); setAceitando({ linha: l, tipo: 'descartar_proposta' }); }}>
                <CircleSlash aria-hidden="true" className="size-3.5" /> Não cancelar
              </Button>
            </>
          ) : l.aceita_motivo ? (
            <Button type="button" variant="ghost" className={BOTAO_DISCRETO} onClick={() => void agir({ acao: 'desfazer_aceite', linha_id: l.id }, 'Aceite retirado')}>Tirar aceite</Button>
          ) : !l.resolvida ? (
            <>
              {!l.venda_id || l.situacao === 'NAO_ENCONTRADO' ? (
                <Button type="button" variant="ghost" className={BOTAO_LINHA} onClick={() => { setTermo(l.localizador || l.passageiro); setLigando(l); }}>
                  <Link2 aria-hidden="true" className="size-4" /> Ligar à venda
                </Button>
              ) : null}
              <Button type="button" variant="ghost" className={BOTAO_DISCRETO} onClick={() => { setMotivo(''); setAceitando({ linha: l, tipo: 'aceitar' }); }}>
                <CheckCircle2 aria-hidden="true" className="size-3.5" /> Aceitar
              </Button>
            </>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={FileSearch}
        titulo={c ? `Extrato ${c.fornecedor_nome}` : 'Conferência de operadora'}
        subtitulo={c ? `${periodo(c.periodo_de, c.periodo_ate)} · ${c.arquivo_nome}${c.criada_por_nome ? ` · aberta por ${c.criada_por_nome}` : ''}` : undefined}
        badge={c ? <StatusChip dominio="conferencia" valor={c.status} size="md" /> : undefined}
        acaoPrimaria={c ? (fechada
          ? { rotulo: 'Reabrir conferência', icone: LockOpen, onClick: () => { setMotivo(''); setReabrindo(true); } }
          : { rotulo: 'Fechar conferência', icone: Lock, onClick: () => setFechando(true) }) : undefined}
        acoesSecundarias={[
          ...(c && !fechada ? [{ rotulo: 'Casar de novo com as vendas', onClick: () => void agir({ acao: 'recasar' }, 'Linhas casadas de novo com as vendas de agora') }] : []),
          { rotulo: 'Todas as conferências', onClick: onVoltar },
        ]}
        onRecarregar={carregar}
      />
      <DataState
        estado={erro ? 'erro' : d ? 'ok' : 'carregando'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => void carregar() } : null}
        esqueleto={<FinTable linhas={[]} colunas={colunas} chave={l => l.id} estado="carregando" vazio={{ motivo: 'sem-dado', titulo: '', oQueE: '' }} />}
      >
        {d && c ? (
          <div className={RITMO_DA_PAGINA}>
            <div className="grid gap-[var(--fin-s-3)] sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard rotulo="Conferidas" icone={CheckCircle2} formato="contagem" valor={c.contagem.resolvidas} estado="ok" tone="positivo"
                contexto={`de ${c.contagem.total} linhas, contando as aceitas`} onClick={() => setFiltro('todas')} ativo={filtro === 'todas'} />
              <MetricCard rotulo="Divergentes" icone={AlertTriangle} formato="contagem" valor={c.contagem.DIVERGENTE} estado="ok"
                tone={c.contagem.DIVERGENTE > 0 ? 'negativo' : 'neutro'} contexto="valor, comissão, taxa ou cancelamento" onClick={() => setFiltro('DIVERGENTE')} ativo={filtro === 'DIVERGENTE'} />
              <MetricCard rotulo="Não encontradas" icone={Search} formato="contagem" valor={c.contagem.NAO_ENCONTRADO} estado="ok"
                tone={c.contagem.NAO_ENCONTRADO > 0 ? 'negativo' : 'neutro'} contexto="sem venda com o localizador" onClick={() => setFiltro('NAO_ENCONTRADO')} ativo={filtro === 'NAO_ENCONTRADO'} />
              {d.comissao ? (
                <MetricCard rotulo="Comissão informada" valor={d.comissao.informada_centavos / 100} estado="ok" tomDoIcone="violeta"
                  tone={d.comissao.diferenca_informada_centavos < 0 ? 'negativo' : 'neutro'}
                  contexto={`esperada ${formatBRL(d.comissao.esperada_centavos / 100)}, recebida ${formatBRL(d.comissao.recebida_centavos / 100)}`} />
              ) : (
                <MetricCard rotulo="Cancelamentos a decidir" formato="contagem" valor={c.contagem.propostas} estado="ok" contexto="propostos pela operadora" />
              )}
            </div>

            {c.avisos.length > 0 ? <Callout tom="aviso" titulo="A soma do documento não bate">{c.avisos.join(' ')}</Callout> : null}
            {fechada ? (
              <Callout tom="info" titulo="Conferência fechada">
                Fechada{c.fechada_por ? ` por ${c.fechada_por}` : ''}{c.fechada_em ? ` em ${formatDate(c.fechada_em.slice(0, 10))}` : ''}. Para mudar alguma linha, reabra com o motivo.
              </Callout>
            ) : !d.fechar.ok ? (
              <Callout tom="info" titulo="Para fechar">{d.fechar.motivos.join(' ')}</Callout>
            ) : (
              <Callout tom="positivo" titulo="Pronta para fechar">Todas as linhas estão conferidas ou aceitas.</Callout>
            )}
            {c.reaberta_motivo && !fechada ? <p className="fin-t-caption text-[var(--fin-text-3)]">Reaberta: {c.reaberta_motivo}</p> : null}

            <Segmentado<Filtro>
              rotulo="Linhas"
              valor={filtro}
              onChange={setFiltro}
              cheio="celular"
              opcoes={[
                { valor: 'resolver', rotulo: 'A resolver', contagem: contar('resolver') },
                { valor: 'DIVERGENTE', rotulo: 'Divergentes', contagem: contar('DIVERGENTE') },
                { valor: 'NAO_ENCONTRADO', rotulo: 'Não encontradas', contagem: contar('NAO_ENCONTRADO') },
                { valor: 'propostas', rotulo: 'Cancelamentos', contagem: contar('propostas') },
                { valor: 'todas', rotulo: 'Todas', contagem: contar('todas') },
              ]}
            />
            <FinTable linhas={linhas} colunas={colunas} chave={l => l.id} estado="ok"
              vazio={filtro === 'resolver'
                ? { motivo: 'sem-resultado', titulo: 'Nada a resolver', oQueE: 'Todas as linhas estão conferidas ou aceitas.', acaoSecundaria: { rotulo: 'Ver todas', onClick: () => setFiltro('todas') } }
                : { motivo: 'sem-resultado', titulo: 'Nenhuma linha neste recorte', oQueE: 'Escolha outro recorte acima.' }} />
          </div>
        ) : null}
      </DataState>

      <RecordSheet
        aberto={aceitando !== null}
        onOpenChange={a => { if (!a) setAceitando(null); }}
        titulo={aceitando?.tipo === 'descartar_proposta' ? 'Não cancelar a venda' : 'Aceitar esta linha'}
        descricao={aceitando ? `${aceitando.linha.localizador || 'Sem localizador'}${aceitando.linha.passageiro ? `, ${aceitando.linha.passageiro}` : ''}` : undefined}
        acaoPrimaria={{
          rotulo: aceitando?.tipo === 'descartar_proposta' ? 'Manter a venda' : 'Aceitar',
          carregando: ocupado, desabilitado: motivo.trim().length < 3,
          onClick: async () => {
            if (!aceitando) return;
            const ok = await agir({ acao: aceitando.tipo, linha_id: aceitando.linha.id, motivo }, aceitando.tipo === 'aceitar' ? 'Linha aceita' : 'Proposta descartada, a venda continua');
            if (ok) setAceitando(null);
          },
        }}
      >
        <div className="flex flex-col gap-[var(--fin-s-3)]">
          {aceitando?.linha.diferencas.map((df, i) => <p key={i} className="fin-t-body text-[var(--fin-text-2)]">{df.texto}</p>)}
          <Field rotulo="Motivo" obrigatorio ajuda={aceitando?.tipo === 'descartar_proposta' ? 'Por que o cancelamento da operadora não vale para esta venda.' : 'Por que a linha está certa assim. Fica registrado com o seu nome.'}>
            {a => <Textarea {...a} rows={3} className="fin-t-body rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)]" value={motivo} onChange={e => setMotivo(e.target.value)} />}
          </Field>
        </div>
      </RecordSheet>

      <RecordSheet
        aberto={ligando !== null}
        onOpenChange={a => { if (!a) { setLigando(null); setAchados([]); } }}
        titulo="Ligar a linha a uma venda"
        descricao={ligando ? `${ligando.localizador || 'Sem localizador'}${ligando.passageiro ? `, ${ligando.passageiro}` : ''}: ${formatBRL(cobrado(ligando) ?? 0)}` : undefined}
        largura={640}
        acaoPrimaria={{ rotulo: 'Fechar', onClick: () => { setLigando(null); setAchados([]); } }}
      >
        <div className="flex flex-col gap-[var(--fin-s-3)]">
          <Field rotulo="Buscar a venda" ajuda="Localizador, número da venda ou nome do passageiro.">
            {a => <Input {...a} autoFocus className={CONTROLE} value={termo} onChange={e => setTermo(e.target.value)} />}
          </Field>
          <ul className="flex flex-col gap-[var(--fin-s-2)]">
            {achados.map(it => (
              <li key={it.item_id} className={cn(CARTAO, 'flex items-center justify-between gap-[var(--fin-s-3)] p-[var(--fin-s-3)]')}>
                <span className="flex min-w-0 flex-col">
                  <span className="fin-t-body-strong truncate">Venda {it.venda_numero} · {it.localizador || 'sem localizador'}</span>
                  <span className="fin-t-caption truncate text-[var(--fin-text-3)]">{it.descricao}{it.fornecedor_nome ? ` · ${it.fornecedor_nome}` : ''}{it.data_venda ? ` · ${formatDate(it.data_venda)}` : ''}</span>
                </span>
                <Button type="button" variant="ghost" className={BOTAO_LINHA} disabled={ocupado}
                  onClick={async () => { if (ligando && await agir({ acao: 'ligar', linha_id: ligando.id, item_id: it.item_id }, 'Linha ligada à venda e comparada de novo')) setLigando(null); }}>
                  Ligar
                </Button>
              </li>
            ))}
            {termo.trim().length >= 2 && achados.length === 0 ? <li className="fin-t-caption text-[var(--fin-text-3)]">Nenhuma venda encontrada com esse texto.</li> : null}
          </ul>
        </div>
      </RecordSheet>

      <ConfirmDialog
        aberto={fechando}
        onOpenChange={setFechando}
        titulo="Fechar a conferência"
        oQueVaiAcontecer={d?.fechar.ok
          ? 'A conferência fica travada: nenhuma linha muda até alguém reabrir com o motivo. Vendas e contas não são alteradas.'
          : `Ainda não dá para fechar. ${d?.fechar.motivos.join(' ') ?? ''}`}
        detalhes={c ? [
          { rotulo: 'Operadora', valor: c.fornecedor_nome },
          { rotulo: 'Período', valor: periodo(c.periodo_de, c.periodo_ate) },
          { rotulo: 'Linhas conferidas', valor: `${c.contagem.resolvidas} de ${c.contagem.total}` },
        ] : undefined}
        confirmarRotulo="Fechar conferência"
        processando={ocupado}
        onConfirmar={async () => { if (await agir({ acao: 'fechar' }, 'Conferência fechada')) setFechando(false); }}
      />

      <RecordSheet
        aberto={reabrindo}
        onOpenChange={setReabrindo}
        titulo="Reabrir a conferência"
        descricao="As linhas voltam a poder mudar. O motivo fica registrado."
        acaoPrimaria={{
          rotulo: 'Reabrir', carregando: ocupado, desabilitado: motivo.trim().length < 3,
          onClick: async () => { if (await agir({ acao: 'reabrir', motivo }, 'Conferência reaberta')) setReabrindo(false); },
        }}
      >
        <Field rotulo="Motivo" obrigatorio>
          {a => <Textarea {...a} rows={3} className="fin-t-body rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)]" value={motivo} onChange={e => setMotivo(e.target.value)} />}
        </Field>
      </RecordSheet>

      <p className="fin-t-caption flex items-center gap-[var(--fin-s-1)] text-[var(--fin-text-3)]">
        <RefreshCw aria-hidden="true" className="size-3.5" />
        A conferência nunca mexe em venda, conta ou saldo. Cancelamento é proposto e decidido na venda.
        <button type="button" onClick={onVoltar} className={cn('ml-auto inline-flex items-center gap-1 text-[var(--fin-accent)] underline-offset-2 hover:underline', FOCO)}>
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Todas as conferências
        </button>
      </p>
    </MolduraDaPagina>
  );
}
