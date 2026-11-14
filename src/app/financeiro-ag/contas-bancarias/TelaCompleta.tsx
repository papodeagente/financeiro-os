'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import { Banknote, Building2, CreditCard, Landmark, Pencil, PiggyBank, Plus, Trash2, TrendingUp } from 'lucide-react';

import { ContaBancaria } from '@/lib/crm-types';
import { loadEntities, saveEntity } from '@/lib/crm-storage';
import { atualizarRegistro, excluirRegistro, ErroAoGravar } from '@/lib/gravar-registro';
import { BANCOS, bancoPorCodigo, rotuloDoBanco } from '@/lib/bancos';
import { contaBancariaAtiva } from '@/lib/contas-bancarias-regras';
import { identificacaoDaConta } from '@/lib/contas-bancarias-dados';
import { AvisoDeEdicaoSimultanea } from '@/components/fin/AvisoDeEdicaoSimultanea';
import { HistoricoRecolhivel } from '@/components/fin/HistoricoDoRegistro';
import { somaPor } from '@/lib/money';
import {
  formatarCambio, formatarNaMoeda, infoDaMoeda, moedaDe, saldoTotalEmReais, saldosEmReais,
  type SaldoEmReais,
} from '@/lib/cambio';
import { useCotacoes } from '@/components/fin/useCotacoes';
import { useMoedas } from '@/components/fin/useMoedas';
import { moedasParaEscolher } from '@/lib/moedas';
import { Callout } from '@/components/fin/Callout';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { ConfirmDialog } from '@/components/fin/ConfirmDialog';
import { DataState } from '@/components/fin/DataState';
import { Field } from '@/components/fin/Field';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { Money } from '@/components/fin/Money';
import { MoneyField } from '@/components/fin/MoneyField';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { CampoEmpresa, CampoEmpresasDisponiveis, useEmpresaSugerida } from '@/components/fin/CamposDeEmpresa';
import type { EmptyLessonProps } from '@/components/fin/EmptyLesson';

const TIPO_LABEL: Record<ContaBancaria['tipo'], string> = {
  CORRENTE: 'Conta corrente',
  POUPANCA: 'Poupança',
  CARTAO_CREDITO: 'Cartão de crédito',
  CAIXA: 'Caixa',
  APLICACAO: 'Aplicação',
};

const TIPO_ICONE: Record<ContaBancaria['tipo'], React.ReactNode> = {
  CORRENTE: <Building2 className="size-4" />,
  POUPANCA: <PiggyBank className="size-4" />,
  CARTAO_CREDITO: <CreditCard className="size-4" />,
  CAIXA: <Banknote className="size-4" />,
  APLICACAO: <TrendingUp className="size-4" />,
};

const TIPO_OPCOES: { valor: ContaBancaria['tipo']; rotulo: string }[] = [
  { valor: 'CORRENTE', rotulo: TIPO_LABEL.CORRENTE },
  { valor: 'POUPANCA', rotulo: TIPO_LABEL.POUPANCA },
  { valor: 'CARTAO_CREDITO', rotulo: TIPO_LABEL.CARTAO_CREDITO },
  { valor: 'CAIXA', rotulo: TIPO_LABEL.CAIXA },
  { valor: 'APLICACAO', rotulo: TIPO_LABEL.APLICACAO },
];

const TIPO_TODOS = 'TODOS';
const SITUACAO_ATIVAS = 'ATIVAS';
const SITUACAO_DESATIVADAS = 'DESATIVADAS';
const SITUACAO_TODAS = 'TODAS';

const CONTROLE_FORMULARIO =
  'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] lg:h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

const ACAO_DE_LINHA =
  'size-11 rounded-[var(--fin-r-md)] shadow-none lg:size-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

function createNewConta(): ContaBancaria {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
    nome: '',
    tipo: 'CORRENTE',
    banco: '',
    agencia: '',
    conta: '',
    saldo_inicial: 0,
    saldo_atual: 0,
    limite: 0,
    dia_fechamento: 0,
    dia_vencimento: 0,
  };
}

/**
 * Conta com a moeda (05/11/2026, E6), o cadastro completo (06/11/2026, E7:
 * titular, banco da lista oficial, dígitos separados e desativada) e a
 * empresa (E7: a dona e as outras em que a conta está disponível). Ausentes
 * = como sempre foi (real, ativa, banco em texto livre, empresa principal).
 */
type ContaComMoeda = ContaBancaria & {
  moeda?: string;
  titular?: string;
  titular_documento?: string;
  banco_codigo?: string;
  agencia_digito?: string;
  conta_digito?: string;
  ativo?: boolean;
  _versao?: string;
  empresa_id?: string;
  empresas_disponiveis?: string[];
};

type FormState = {
  nome: string;
  moeda: string;
  tipo: ContaBancaria['tipo'];
  banco: string;
  banco_codigo: string;
  agencia: string;
  agencia_digito: string;
  conta: string;
  conta_digito: string;
  titular: string;
  titular_documento: string;
  ativo: boolean;
  saldo_inicial: number;
  empresa_id?: string;
  empresas_disponiveis: string[];
};

const EMPTY_FORM: FormState = {
  nome: '',
  moeda: 'BRL',
  tipo: 'CORRENTE',
  banco: '',
  banco_codigo: '',
  agencia: '',
  agencia_digito: '',
  conta: '',
  conta_digito: '',
  titular: '',
  titular_documento: '',
  ativo: true,
  saldo_inicial: 0,
  empresas_disponiveis: [],
};

/** O que vai para o cadastro a partir do formulário. */
function dadosDoFormulario(f: FormState) {
  return {
    nome: f.nome, moeda: f.moeda, tipo: f.tipo, banco: f.banco, banco_codigo: f.banco_codigo,
    agencia: f.agencia, agencia_digito: f.agencia_digito, conta: f.conta, conta_digito: f.conta_digito,
    titular: f.titular, titular_documento: f.titular_documento, ativo: f.ativo, saldo_inicial: f.saldo_inicial,
  };
}

const ID_LISTA_DE_BANCOS = 'lista-oficial-de-bancos';

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

function identificacaoDe(item: ContaComMoeda): string {
  return identificacaoDaConta(item);
}

/** O banco como aparece: o da lista oficial, senão o texto gravado. */
function bancoDe(item: ContaComMoeda): string {
  const b = bancoPorCodigo(item.banco_codigo);
  return b ? rotuloDoBanco(b) : item.banco;
}

function sublinhaDe(item: ContaComMoeda): string {
  return [bancoDe(item), identificacaoDe(item)].filter(Boolean).join(' · ');
}

function contagemDeContas(n: number): string {
  return n === 1 ? '1 conta cadastrada' : `${n} contas cadastradas`;
}

export default function ContasBancariasPage() {
  const [items, setItems] = useState<ContaComMoeda[]>([]);
  const cotacoes = useCotacoes();
  // Catálogo da agência (E7): as oito do sistema e as que ela cadastrou.
  const { moedas } = useMoedas();
  const empresaSugerida = useEmpresaSugerida();
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [sujo, setSujo] = useState(false);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [aExcluir, setAExcluir] = useState<ContaComMoeda | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  /** A exclusão foi recusada porque a conta tem movimento: oferece desativar. */
  const [comMovimento, setComMovimento] = useState<{ conta: ContaComMoeda; motivo: string } | null>(null);
  const [desativando, setDesativando] = useState(false);
  const [conflito, setConflito] = useState(false);
  const [erroDoForm, setErroDoForm] = useState<string | null>(null);

  const [busca, setBusca] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState<string>(TIPO_TODOS);
  const [situacaoFiltro, setSituacaoFiltro] = useState<string>(SITUACAO_ATIVAS);

  async function load() {
    setLoading(true);
    try {
      const data = await loadEntities<ContaComMoeda>('contas-bancarias');
      setItems(data);
      setErro(null);
      setAtualizadoEm(new Date());
    } catch {
      setErro('A consulta das contas bancárias falhou antes de responder. Nada foi alterado.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function atualizarForm(parcial: Partial<FormState>) {
    setForm(f => ({ ...f, ...parcial }));
    setSujo(true);
  }

  function openNew() {
    setForm({ ...EMPTY_FORM, empresa_id: empresaSugerida });
    setEditId(null);
    setShowForm(true);
    setSujo(false);
    setErroNome(null);
    setErroDoForm(null);
  }

  function openEdit(item: ContaComMoeda) {
    const oficial = bancoPorCodigo(item.banco_codigo);
    setForm({
      nome: item.nome,
      moeda: moedaDe(item.moeda),
      tipo: item.tipo,
      banco: oficial ? rotuloDoBanco(oficial) : item.banco ?? '',
      banco_codigo: oficial?.codigo ?? '',
      agencia: item.agencia ?? '',
      agencia_digito: item.agencia_digito ?? '',
      conta: item.conta ?? '',
      conta_digito: item.conta_digito ?? '',
      titular: item.titular ?? '',
      titular_documento: item.titular_documento ?? '',
      ativo: contaBancariaAtiva(item),
      saldo_inicial: item.saldo_inicial,
      empresa_id: item.empresa_id,
      empresas_disponiveis: Array.isArray(item.empresas_disponiveis) ? item.empresas_disponiveis : [],
    });
    setEditId(item.id);
    setShowForm(true);
    setSujo(false);
    setErroNome(null);
    setErroDoForm(null);
  }

  async function handleSave() {
    if (!form.nome) {
      setErroNome('Escreva o nome da conta para poder salvar.');
      return;
    }
    setErroNome(null);
    setSalvando(true);
    try {
      // Banco da lista oficial: grava o nome e o código; texto livre (conta
      // antiga) continua como estava.
      const oficial = form.banco_codigo ? bancoPorCodigo(form.banco_codigo) : null;
      const dados = { ...dadosDoFormulario(form), banco: oficial ? oficial.nome : form.banco };
      if (editId) {
        const existing = items.find(i => i.id === editId)!;
        // Leva a versão lida: se outra pessoa salvou depois, nada é gravado (409).
        await atualizarRegistro('contas-bancarias', {
          ...existing,
          ...dados,
          ...(form.empresa_id ? { empresa_id: form.empresa_id } : {}),
          empresas_disponiveis: form.empresas_disponiveis.filter(e => e !== form.empresa_id),
        });
      } else {
        const nova: ContaComMoeda = {
          ...createNewConta(),
          ...dados,
          saldo_atual: form.saldo_inicial,
          ...(form.empresa_id ? { empresa_id: form.empresa_id } : {}),
          ...(form.empresas_disponiveis.length ? { empresas_disponiveis: form.empresas_disponiveis.filter(e => e !== form.empresa_id) } : {}),
        };
        const r = await saveEntity('contas-bancarias', nova) as ContaComMoeda & { error?: string };
        if (r && typeof r.error === 'string') throw new Error(r.error);
      }
      setShowForm(false);
      setEditId(null);
      setSujo(false);
      toast.success(editId ? 'Conta atualizada.' : 'Conta criada.');
      load();
    } catch (e) {
      if (e instanceof ErroAoGravar && e.conflito) { setConflito(true); return; }
      // O servidor explica (moeda de conta com movimento, dígito, documento do titular).
      const msg = e instanceof Error && e.message ? e.message : 'Não foi possível salvar a conta. Nada foi alterado.';
      setErroDoForm(msg);
      toast.error('Não foi possível salvar a conta', msg);
    } finally {
      setSalvando(false);
    }
  }

  async function recarregarDepoisDoConflito() {
    setConflito(false);
    setShowForm(false);
    setEditId(null);
    setSujo(false);
    await load();
  }

  async function desativar(conta: ContaComMoeda) {
    setDesativando(true);
    try {
      await atualizarRegistro('contas-bancarias', { ...conta, ativo: false });
      setComMovimento(null);
      toast.success('Conta desativada', 'Ela some das telas de lançar, pagar e receber e continua nos relatórios.');
      load();
    } catch (e) {
      if (e instanceof ErroAoGravar && e.conflito) { setComMovimento(null); setConflito(true); return; }
      toast.error('Não foi possível desativar a conta', e instanceof Error ? e.message : '');
    } finally {
      setDesativando(false);
    }
  }

  async function reativar(conta: ContaComMoeda) {
    try {
      await atualizarRegistro('contas-bancarias', { ...conta, ativo: true });
      toast.success('Conta reativada');
      load();
    } catch (e) {
      if (e instanceof ErroAoGravar && e.conflito) { setConflito(true); return; }
      toast.error('Não foi possível reativar a conta', e instanceof Error ? e.message : '');
    }
  }

  async function handleDelete(conta: ContaComMoeda) {
    setExcluindo(true);
    try {
      await excluirRegistro('contas-bancarias', conta.id);
      setAExcluir(null);
      toast.success('Conta excluída.');
      load();
    } catch (e) {
      setAExcluir(null);
      // Conta já usada não se exclui: oferece desativar.
      if (e instanceof ErroAoGravar && e.corpo.com_movimento === true) {
        setComMovimento({ conta, motivo: e.message });
      } else {
        toast.error('Não foi possível excluir a conta. Nada foi alterado.', e instanceof Error ? e.message : '');
      }
    } finally {
      setExcluindo(false);
    }
  }

  // Saldo de cada conta em reais (conta em moeda pela PTAX de venda do cache).
  // Só contas em real: o mesmo número de sempre.
  const listaDeCotacoes = cotacoes.painel?.cotacoes;
  const saldos = useMemo(() => new Map(saldosEmReais(items, listaDeCotacoes ?? [], moedas).map(x => [x.id, x])), [items, listaDeCotacoes, moedas]);
  const temMoeda = items.some(i => moedaDe(i.moeda) !== 'BRL');
  const somaEmReais = (lista: ContaComMoeda[]) => saldoTotalEmReais(lista.map(i => saldos.get(i.id)).filter((x): x is SaldoEmReais => !!x));
  const totalGeral = somaEmReais(items);
  const totalSaldo = temMoeda ? totalGeral.total : somaPor(items, i => i.saldo_atual);
  const semCotacao = items.filter(i => totalGeral.sem_cotacao.includes(i.id));

  const estado: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : erro ? 'erro' : 'ok';

  const filtradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    return items.filter(item => {
      if (tipoFiltro !== TIPO_TODOS && item.tipo !== tipoFiltro) return false;
      const ativa = contaBancariaAtiva(item);
      if (situacaoFiltro === SITUACAO_ATIVAS && !ativa) return false;
      if (situacaoFiltro === SITUACAO_DESATIVADAS && ativa) return false;
      if (!termo) return true;
      const alvo = normalizar(`${item.nome} ${bancoDe(item)} ${item.agencia} ${item.conta} ${item.titular ?? ''}`);
      return alvo.includes(termo);
    });
  }, [items, busca, tipoFiltro, situacaoFiltro]);
  const desativadas = items.filter(i => !contaBancariaAtiva(i)).length;

  const totalDoRecorte = temMoeda ? somaEmReais(filtradas).total : somaPor(filtradas, i => i.saldo_atual);
  const filtrosAtivos = (busca.trim() ? 1 : 0) + (tipoFiltro !== TIPO_TODOS ? 1 : 0) + (situacaoFiltro !== SITUACAO_ATIVAS ? 1 : 0);

  function limparFiltros() {
    setBusca('');
    setTipoFiltro(TIPO_TODOS);
    setSituacaoFiltro(SITUACAO_ATIVAS);
  }

  const vazio: EmptyLessonProps =
    filtrosAtivos > 0
      ? {
          motivo: 'sem-resultado',
          titulo: 'Nenhuma conta com esse filtro',
          oQueE: 'As contas existem, mas nenhuma combina com a busca e o tipo escolhidos agora.',
          acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limparFiltros },
        }
      : {
          motivo: 'sem-dado',
          titulo: 'Nenhuma conta cadastrada ainda',
          oQueE:
            'Aqui ficam as contas, caixas e cartões por onde o dinheiro da agência entra e sai. É a soma delas que vira o saldo em caixa do painel.',
          comoComeca: [
            'Cadastre primeiro a conta que a agência mais usa no dia a dia.',
            'No saldo inicial, copie o saldo que o aplicativo do banco mostra hoje.',
            'Daqui em diante, o que você receber e pagar move esse saldo sozinho.',
          ],
          acao: { rotulo: 'Nova conta', onClick: openNew },
        };

  const colunas: FinColuna<ContaComMoeda>[] = [
    {
      id: 'conta',
      cabecalho: 'Conta',
      tipo: 'texto',
      sortable: true,
      minWidth: 220,
      acessor: item => item.nome,
      render: item => (
        <span className="flex items-center gap-[var(--fin-s-2)]">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] text-[var(--fin-text-3)]"
          >
            {TIPO_ICONE[item.tipo]}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-[var(--fin-s-2)]">
              <span className="fin-t-body-strong truncate text-[var(--fin-text)]">{item.nome}</span>
              {contaBancariaAtiva(item) ? null : (
                <span className="shrink-0 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)] px-1.5 py-0.5 fin-t-caption text-[var(--fin-text-2)]">Desativada</span>
              )}
            </span>
            {item.titular ? <span className="fin-t-caption truncate text-[var(--fin-text-3)]">Titular: {item.titular}</span> : null}
            {sublinhaDe(item) ? (
              <span className="fin-t-caption hidden truncate text-[var(--fin-text-3)] max-lg:block">
                {sublinhaDe(item)}
              </span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      id: 'banco',
      cabecalho: 'Banco',
      tipo: 'texto',
      sortable: true,
      minWidth: 140,
      prioridade: 1,
      acessor: item => bancoDe(item),
      render: item =>
        bancoDe(item) ? (
          <span>{bancoDe(item)}</span>
        ) : (
          <span className="text-[var(--fin-text-3)]">Não informado</span>
        ),
    },
    {
      id: 'identificacao',
      cabecalho: 'Agência e conta',
      tipo: 'texto',
      minWidth: 160,
      prioridade: 1,
      render: item =>
        identificacaoDe(item) ? (
          <span className="tabular-nums">{identificacaoDe(item)}</span>
        ) : (
          <span className="text-[var(--fin-text-3)]">Não informado</span>
        ),
    },
    {
      id: 'tipo',
      cabecalho: 'Tipo',
      tipo: 'texto',
      sortable: true,
      minWidth: 140,
      acessor: item => TIPO_LABEL[item.tipo],
      render: item => <span>{TIPO_LABEL[item.tipo]}</span>,
    },
    ...(temMoeda
      ? [{
          id: 'moeda',
          cabecalho: 'Na moeda da conta',
          tipo: 'texto' as const,
          sortable: true,
          minWidth: 150,
          prioridade: 2 as const,
          acessor: (item: ContaComMoeda) => moedaDe(item.moeda),
          render: (item: ContaComMoeda) => moedaDe(item.moeda) === 'BRL'
            ? <span className="text-[var(--fin-text-3)]">Real</span>
            : (
              <span className="flex flex-col items-start">
                <span className="fin-t-body-strong tabular-nums">{formatarNaMoeda(item.saldo_atual, moedaDe(item.moeda))}</span>
                <span className="fin-t-caption text-[var(--fin-text-3)]">{infoDaMoeda(moedaDe(item.moeda)).nome}</span>
              </span>
            ),
        }]
      : []),
    {
      id: 'saldo',
      cabecalho: temMoeda ? 'Saldo em reais' : 'Saldo',
      tipo: 'dinheiro',
      sortable: true,
      minWidth: 140,
      valor: item => saldos.get(item.id)?.saldo_reais ?? item.saldo_atual,
      estado: item => (moedaDe(item.moeda) !== 'BRL' && saldos.get(item.id)?.saldo_reais == null ? 'indisponivel' : 'ok'),
      tone: item => (item.saldo_atual < 0 ? 'negativo' : 'neutro'),
      sub: item => {
        const s = saldos.get(item.id);
        if (s && s.moeda !== 'BRL') {
          if (s.saldo_reais === null) return <span>Sem cotação de {s.moeda} para converter; fora do total</span>;
          const ref = s.referencia;
          return (
            <span>
              {formatarNaMoeda(s.saldo_moeda, s.moeda)} a {formatarCambio(s.cambio ?? 0)}
              {ref ? ` (PTAX de ${ref.referencia.slice(8, 10)}/${ref.referencia.slice(5, 7)})` : ''}
            </span>
          );
        }
        if (item.tipo === 'CARTAO_CREDITO' && item.limite > 0) {
          return (
            <span>
              Limite{' '}
              <Money valor={item.limite} size="caption" tone="suave" estado="ok" className="min-w-0" />
              {item.dia_vencimento > 0 ? `, vence dia ${item.dia_vencimento}` : ''}
            </span>
          );
        }
        if (item.saldo_inicial !== item.saldo_atual) {
          return (
            <span>
              Inicial{' '}
              <Money
                valor={item.saldo_inicial}
                size="caption"
                tone="suave"
                estado="ok"
                className="min-w-0"
              />
            </span>
          );
        }
        return null;
      },
    },
    {
      id: 'acoes',
      cabecalho: 'Ações',
      tipo: 'acoes',
      render: item => (
        <>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Editar a conta ${item.nome}`}
            onClick={() => openEdit(item)}
            className={ACAO_DE_LINHA}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
          {contaBancariaAtiva(item) ? null : (
            <Button
              type="button"
              variant="outline"
              aria-label={`Reativar a conta ${item.nome}`}
              onClick={() => { void reativar(item); }}
              className="h-11 rounded-[var(--fin-r-md)] px-[var(--fin-s-3)] shadow-none lg:h-10"
            >
              Reativar
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Excluir a conta ${item.nome}`}
            onClick={() => setAExcluir(item)}
            className={`${ACAO_DE_LINHA} text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </>
      ),
    },
  ];

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-s-5)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)]">
        <div className="pb-[var(--fin-s-4)]">
          <PageHeader
            icone={Landmark}
            titulo="Contas bancárias"
            subtitulo="Contas, caixas e cartões por onde o dinheiro da agência passa."
            acaoPrimaria={{ rotulo: 'Nova conta', icone: Plus, onClick: openNew }}
            atualizadoEm={atualizadoEm}
            onRecarregar={load}
          />
        </div>

        <DataState
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: load } : null}
          esqueleto={
            <div className="flex flex-col gap-[var(--fin-s-5)]">
              <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-2">
                <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]">
                  <span className="block h-3 w-32 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                  <span className="block h-8 w-52 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                  <span className="block h-3 w-40 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                </div>
              </div>
              <FinTable
                linhas={[]}
                colunas={colunas}
                chave={item => item.id}
                estado="carregando"
                vazio={vazio}
              />
            </div>
          }
        >
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            {items.length > 0 ? (
              <div className="flex flex-col gap-[var(--fin-s-2)]">
                <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-2">
                  <MetricCard
                    rotulo={temMoeda ? 'Saldo total em reais' : 'Saldo total em caixa'} icone={Landmark}
                    valor={totalSaldo}
                    estado={temMoeda && cotacoes.estado === 'carregando' ? 'carregando' : 'ok'}
                    emphasis="destaque"
                    tone={totalSaldo < 0 ? 'negativo' : 'neutro'}
                    contexto={contagemDeContas(items.length)}
                    explicacao={temMoeda
                      ? 'Contas em real pelo saldo; contas em moeda convertidas pela PTAX de venda mais recente do Banco Central.'
                      : 'Saldo inicial mais recebido menos pago, somando todas as contas.'}
                  />
                </div>
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  Como o saldo de cada conta é formado: saldo inicial mais recebido menos pago
                  {temMoeda ? ', na moeda da própria conta.' : '.'}
                </p>
                {semCotacao.length > 0 ? (
                  <Callout tom="aviso" titulo="Conta em moeda fora do total">
                    {semCotacao.map(c => c.nome).join(', ')} {semCotacao.length === 1 ? 'ficou' : 'ficaram'} fora do total em reais porque
                    ainda não há PTAX guardada para {[...new Set(semCotacao.map(c => moedaDe(c.moeda)))].join(' e ')}. O saldo na moeda
                    continua certo; a conversão volta sozinha quando a cotação chegar.
                  </Callout>
                ) : null}
              </div>
            ) : null}

            {items.length > 0 ? (
              <FilterBar
                busca={{
                  valor: busca,
                  onChange: setBusca,
                  placeholder: 'Buscar por conta, banco, agência ou número',
                }}
                selects={[
                  {
                    id: 'filtro-tipo-conta',
                    rotulo: 'Tipo',
                    valor: tipoFiltro,
                    onChange: setTipoFiltro,
                    opcoes: [
                      { valor: TIPO_TODOS, rotulo: 'Todos os tipos' },
                      ...TIPO_OPCOES.map(o => ({ valor: o.valor, rotulo: o.rotulo })),
                    ],
                  },
                  ...(desativadas > 0 || situacaoFiltro !== SITUACAO_ATIVAS ? [{
                    id: 'filtro-situacao-conta',
                    rotulo: 'Situação',
                    valor: situacaoFiltro,
                    onChange: setSituacaoFiltro,
                    opcoes: [
                      { valor: SITUACAO_ATIVAS, rotulo: 'Ativas' },
                      { valor: SITUACAO_DESATIVADAS, rotulo: `Desativadas (${desativadas})` },
                      { valor: SITUACAO_TODAS, rotulo: 'Todas' },
                    ],
                  }] : []),
                ]}
                resumo={{
                  exibidos: filtradas.length,
                  total: items.length,
                  substantivo: 'contas',
                  soma: totalDoRecorte,
                }}
                ativos={filtrosAtivos}
                onLimpar={limparFiltros}
              />
            ) : null}

            <FinTable
              linhas={filtradas}
              colunas={colunas}
              chave={item => item.id}
              estado="ok"
              vazio={vazio}
              totais={[
                {
                  colunaId: 'saldo',
                  valor: totalDoRecorte,
                  rotulo: filtrosAtivos > 0 ? 'Total das contas filtradas' : temMoeda ? 'Total em reais' : 'Total em caixa',
                },
              ]}
            />
          </div>
        </DataState>
      </div>

      <RecordSheet
        aberto={showForm}
        onOpenChange={setShowForm}
        titulo={editId ? 'Editar conta' : 'Nova conta'}
        descricao="O saldo inicial é o ponto de partida. Os recebimentos e pagamentos movem o saldo daqui em diante."
        sujo={sujo}
        acaoPrimaria={{
          rotulo: editId ? 'Salvar conta' : 'Criar conta',
          onClick: handleSave,
          carregando: salvando,
        }}
      >
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <Field
            rotulo="Nome da conta"
            obrigatorio
            ajuda="O apelido que sua equipe usa para reconhecer a conta."
            erro={erroNome}
          >
            {a => (
              <Input
                id={a.id}
                aria-invalid={a['aria-invalid'] || undefined}
                aria-describedby={a['aria-describedby']}
                value={form.nome}
                onChange={e => atualizarForm({ nome: e.target.value })}
                placeholder="Bradesco PJ principal"
                className={CONTROLE_FORMULARIO}
              />
            )}
          </Field>

          {/* Várias empresas (E7): só aparecem com duas ou mais. */}
          <CampoEmpresa
            valor={form.empresa_id}
            onChange={empresa_id => atualizarForm({ empresa_id, empresas_disponiveis: form.empresas_disponiveis.filter(e => e !== empresa_id) })}
            ajuda="A empresa dona da conta. O dinheiro que entra e sai por ela conta nesta empresa."
          />
          <CampoEmpresasDisponiveis
            dona={form.empresa_id}
            valor={form.empresas_disponiveis}
            onChange={empresas_disponiveis => atualizarForm({ empresas_disponiveis })}
          />

          <Field rotulo="Tipo de conta">
            {a => (
              <Select
                value={form.tipo}
                onValueChange={v => atualizarForm({ tipo: v as ContaBancaria['tipo'] })}
              >
                <SelectTrigger
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  className={CONTROLE_FORMULARIO}
                >
                  <SelectValue>{() => TIPO_LABEL[form.tipo]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TIPO_OPCOES.map(opcao => (
                    <SelectItem key={opcao.valor} value={opcao.valor} className="fin-t-body">
                      {opcao.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field
            rotulo="Moeda da conta"
            ajuda="O saldo da conta fica nesta moeda. Depois do primeiro movimento a moeda não muda; para outra moeda, crie outra conta."
          >
            {a => (
              <Select value={form.moeda} onValueChange={v => atualizarForm({ moeda: v ?? 'BRL' })}>
                <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={CONTROLE_FORMULARIO}>
                  <SelectValue>{() => `${infoDaMoeda(form.moeda).nome} (${infoDaMoeda(form.moeda).simbolo})`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {moedasParaEscolher(moedas, form.moeda).map(m => (
                    <SelectItem key={m.codigo} value={m.codigo} className="fin-t-body">
                      {m.nome} ({m.simbolo})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field
            rotulo="Banco"
            ajuda={form.banco_codigo
              ? `Da lista oficial do Banco Central (código ${form.banco_codigo}).`
              : form.banco
                ? 'Escreva o código ou o nome e escolha na lista oficial do Banco Central.'
                : 'Escreva o código (ex.: 341) ou o nome e escolha na lista oficial do Banco Central.'}
          >
            {a => (
              <>
                <Input
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  value={form.banco}
                  list={ID_LISTA_DE_BANCOS}
                  autoComplete="off"
                  onChange={e => {
                    const texto = e.target.value;
                    const escolhido = BANCOS.find(b => rotuloDoBanco(b) === texto);
                    atualizarForm({ banco: texto, banco_codigo: escolhido?.codigo ?? '' });
                  }}
                  placeholder="341 · Itaú, 077 · Inter, 260 · Nu"
                  className={CONTROLE_FORMULARIO}
                />
                <datalist id={ID_LISTA_DE_BANCOS}>
                  {BANCOS.map(b => <option key={b.codigo} value={rotuloDoBanco(b)} />)}
                </datalist>
              </>
            )}
          </Field>

          <div className="grid grid-cols-[1fr_5rem] gap-[var(--fin-s-3)] sm:grid-cols-[1fr_5rem_1fr_5rem]">
            <Field rotulo="Agência">
              {a => (
                <Input
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  value={form.agencia}
                  inputMode="numeric"
                  onChange={e => atualizarForm({ agencia: e.target.value })}
                  placeholder="0000"
                  className={`${CONTROLE_FORMULARIO} tabular-nums`}
                />
              )}
            </Field>
            <Field rotulo="Dígito">
              {a => (
                <Input
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  aria-label="Dígito da agência"
                  value={form.agencia_digito}
                  maxLength={2}
                  onChange={e => atualizarForm({ agencia_digito: e.target.value.toUpperCase() })}
                  placeholder="0"
                  className={`${CONTROLE_FORMULARIO} tabular-nums`}
                />
              )}
            </Field>

            <Field rotulo="Número da conta">
              {a => (
                <Input
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  value={form.conta}
                  inputMode="numeric"
                  onChange={e => atualizarForm({ conta: e.target.value })}
                  placeholder="00000000"
                  className={`${CONTROLE_FORMULARIO} tabular-nums`}
                />
              )}
            </Field>
            <Field rotulo="Dígito">
              {a => (
                <Input
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  aria-label="Dígito da conta"
                  value={form.conta_digito}
                  maxLength={2}
                  onChange={e => atualizarForm({ conta_digito: e.target.value.toUpperCase() })}
                  placeholder="0"
                  className={`${CONTROLE_FORMULARIO} tabular-nums`}
                />
              )}
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-[1fr_12rem]">
            <Field rotulo="Titular" ajuda="De quem é a conta, como está no banco. Opcional.">
              {a => (
                <Input
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  value={form.titular}
                  maxLength={120}
                  onChange={e => atualizarForm({ titular: e.target.value })}
                  placeholder="Entur Viagens Ltda."
                  className={CONTROLE_FORMULARIO}
                />
              )}
            </Field>
            <Field rotulo="CPF ou CNPJ do titular">
              {a => (
                <Input
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  value={form.titular_documento}
                  inputMode="numeric"
                  maxLength={18}
                  onChange={e => atualizarForm({ titular_documento: e.target.value })}
                  placeholder="Só números"
                  className={`${CONTROLE_FORMULARIO} tabular-nums`}
                />
              )}
            </Field>
          </div>

          <MoneyField
            rotulo="Saldo inicial"
            valor={form.saldo_inicial}
            moeda={form.moeda}
            onChange={v => atualizarForm({ saldo_inicial: v })}
            ajuda={form.moeda === 'BRL'
              ? 'Copie o saldo que o aplicativo do banco mostra hoje.'
              : `Na moeda da conta (${form.moeda}): copie o saldo que o banco mostra hoje.`}
          />

          {editId ? (
            <label className="flex items-start gap-2 fin-t-body text-[var(--fin-text)]">
              <input
                type="checkbox"
                checked={!form.ativo}
                onChange={e => atualizarForm({ ativo: !e.target.checked })}
                className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]"
              />
              <span>
                Conta desativada
                <span className="block fin-t-caption text-[var(--fin-text-3)]">
                  Some das telas de lançar, pagar, receber e transferir. Continua nos relatórios, no extrato e no saldo total.
                </span>
              </span>
            </label>
          ) : null}

          {erroDoForm ? <p role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{erroDoForm}</p> : null}

          {editId ? <HistoricoRecolhivel entidade="contas_bancarias" id={editId} /> : null}
        </div>
      </RecordSheet>

      <AvisoDeEdicaoSimultanea
        aberto={conflito}
        onOpenChange={setConflito}
        onRecarregar={recarregarDepoisDoConflito}
        oQue="esta conta bancária"
      />

      <ConfirmDialog
        aberto={comMovimento !== null}
        onOpenChange={aberto => { if (!aberto) setComMovimento(null); }}
        titulo="Esta conta já foi usada"
        oQueVaiAcontecer={comMovimento?.motivo ?? ''}
        detalhes={comMovimento ? [{ rotulo: 'Conta', valor: comMovimento.conta.nome }] : undefined}
        confirmarRotulo="Desativar a conta"
        voltarRotulo="Deixar como está"
        processando={desativando}
        onConfirmar={() => { if (comMovimento) return desativar(comMovimento.conta); }}
      />

      <ConfirmDialog
        aberto={aExcluir !== null}
        onOpenChange={aberto => {
          if (!aberto) setAExcluir(null);
        }}
        titulo="Excluir esta conta bancária"
        oQueVaiAcontecer="Só a conta que nunca foi usada pode ser excluída: ela sai da lista e o saldo dela deixa de entrar no total. Se já houver pagamentos, recebimentos ou transferências nela, a exclusão é recusada e você pode desativá-la."
        detalhes={
          aExcluir
            ? [
                { rotulo: 'Conta', valor: aExcluir.nome },
                { rotulo: 'Tipo', valor: TIPO_LABEL[aExcluir.tipo] },
                {
                  rotulo: 'Saldo atual',
                  valor: <Money valor={aExcluir.saldo_atual} size="strong" estado="ok" />,
                },
              ]
            : undefined
        }
        confirmarRotulo="Excluir conta"
        tone="destrutivo"
        processando={excluindo}
        onConfirmar={() => {
          if (aExcluir) return handleDelete(aExcluir);
        }}
      />
    </div>
  );
}
