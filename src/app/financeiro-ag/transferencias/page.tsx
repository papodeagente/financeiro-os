'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, Trash2, Undo2 } from 'lucide-react';

import { TransferenciaBancaria, ContaBancaria, createTransferencia, StatusTransferencia } from '@/lib/crm-types';
import { loadEntities, saveEntity } from '@/lib/crm-storage';
import { somaPor, round2, hojeISO } from '@/lib/money';
import { toast } from '@/lib/toast';

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
import { rotuloStatus } from '@/components/fin/StatusChip';
import type { EmptyLessonProps } from '@/components/fin/EmptyLesson';

// Efetivar/cancelar/excluir transferência mexe no saldo das contas e por isso
// vive INTEIRO no servidor (/api/transferencias/[id]): ele relê o saldo do
// banco e aplica o delta. O cliente nunca calcula nem envia saldo_atual.
async function salvarTransferencia(item: TransferenciaBancaria): Promise<TransferenciaBancaria> {
  const res = await fetch(`/api/transferencias/${item.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || 'Não foi possível salvar a transferência.');
  return body as TransferenciaBancaria;
}

async function excluirTransferencia(id: string): Promise<void> {
  const res = await fetch(`/api/transferencias/${id}`, { method: 'DELETE' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || 'Não foi possível excluir a transferência.');
}

const STATUS_TODOS = 'TODOS';

const TITULO_SALDOS_ID = 'titulo-saldo-das-contas';

const STATUS_OPCOES: StatusTransferencia[] = ['PENDENTE', 'EFETIVADA', 'CANCELADA'];

const CONTROLE_FORMULARIO =
  'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] lg:h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

const ACAO_DE_LINHA_TEXTO =
  'fin-t-body h-11 rounded-[var(--fin-r-md)] px-3 shadow-none lg:h-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

const ACAO_DE_LINHA_ICONE =
  'size-11 rounded-[var(--fin-r-md)] shadow-none lg:size-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

type Confirmacao = { tipo: 'efetivar' | 'cancelar' | 'excluir'; item: TransferenciaBancaria };

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

function nomeDaConta(nome: string): string {
  return nome.trim() || 'Conta não informada';
}

function trajeto(item: TransferenciaBancaria): string {
  return `de ${nomeDaConta(item.conta_origem_nome)} para ${nomeDaConta(item.conta_destino_nome)}`;
}

/**
 * Prévia do efeito nos dois saldos, lida dos dados já carregados.
 * 'aplicar' é o movimento normal (sai da origem, entra no destino);
 * 'reverter' é o estorno, que devolve o valor para a origem.
 */
function PreviaDeSaldos({
  contas,
  origemId,
  destinoId,
  valor,
  sentido,
}: {
  contas: ContaBancaria[];
  origemId: string;
  destinoId: string;
  valor: number;
  sentido: 'aplicar' | 'reverter';
}) {
  const origem = contas.find(c => c.id === origemId) ?? null;
  const destino = contas.find(c => c.id === destinoId) ?? null;
  if (!origem || !destino || !(valor > 0)) return null;

  const fator = sentido === 'aplicar' ? -1 : 1;
  const saldoOrigem = round2(origem.saldo_atual + fator * valor);
  const saldoDestino = round2(destino.saldo_atual - fator * valor);

  return (
    <div className="flex flex-col gap-[var(--fin-s-2)]">
      <p className="fin-t-caption text-[var(--fin-text-3)]">Como ficam os saldos depois desta operação</p>
      <div className="flex items-baseline justify-between gap-[var(--fin-s-3)]">
        <span className="fin-t-body min-w-0 truncate text-[var(--fin-text-2)]">{origem.nome}</span>
        <Money
          valor={saldoOrigem}
          size="strong"
          estado="ok"
          tone={saldoOrigem < 0 ? 'negativo' : 'neutro'}
        />
      </div>
      <div className="flex items-baseline justify-between gap-[var(--fin-s-3)]">
        <span className="fin-t-body min-w-0 truncate text-[var(--fin-text-2)]">{destino.nome}</span>
        <Money
          valor={saldoDestino}
          size="strong"
          estado="ok"
          tone={saldoDestino < 0 ? 'negativo' : 'neutro'}
        />
      </div>
    </div>
  );
}

export default function TransferenciasPage() {
  const [items, setItems] = useState<TransferenciaBancaria[]>([]);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [contaOrigemId, setContaOrigemId] = useState('');
  const [contaDestinoId, setContaDestinoId] = useState('');
  const [valor, setValor] = useState(0);
  const [data, setData] = useState(hojeISO());
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [criando, setCriando] = useState(false);
  const [sujo, setSujo] = useState(false);
  const [erroOrigem, setErroOrigem] = useState<string | null>(null);
  const [erroDestino, setErroDestino] = useState<string | null>(null);
  const [erroValor, setErroValor] = useState<string | null>(null);

  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);

  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState<string>(STATUS_TODOS);

  async function load() {
    setLoading(true);
    try {
      const [t, c] = await Promise.all([
        loadEntities<TransferenciaBancaria>('transferencias'),
        loadEntities<ContaBancaria>('contas-bancarias'),
      ]);
      setItems(t);
      setContas(c);
      setErro(null);
      setAtualizadoEm(new Date());
    } catch {
      setErro('A consulta das transferências falhou antes de responder. Nada foi alterado.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setContaOrigemId('');
    setContaDestinoId('');
    setValor(0);
    setData(hojeISO());
    setDescricao('');
    setErroOrigem(null);
    setErroDestino(null);
    setErroValor(null);
    setSujo(false);
    setShowForm(true);
  }

  async function handleSave() {
    setErroOrigem(!contaOrigemId ? 'Escolha a conta de onde o dinheiro sai.' : null);
    setErroDestino(
      !contaDestinoId
        ? 'Escolha a conta que vai receber o dinheiro.'
        : contaDestinoId === contaOrigemId
          ? 'A conta de destino precisa ser diferente da conta de origem.'
          : null,
    );
    setErroValor(valor <= 0 ? 'Escreva um valor maior que zero.' : null);
    if (!contaOrigemId || !contaDestinoId || contaOrigemId === contaDestinoId || valor <= 0) return;
    const origem = contas.find(c => c.id === contaOrigemId);
    const destino = contas.find(c => c.id === contaDestinoId);
    const t: TransferenciaBancaria = {
      ...createTransferencia(),
      conta_origem_id: contaOrigemId,
      conta_origem_nome: origem?.nome || '',
      conta_destino_id: contaDestinoId,
      conta_destino_nome: destino?.nome || '',
      valor: round2(valor),
      data,
      descricao,
    };
    setCriando(true);
    try {
      await saveEntity('transferencias', t);
      setShowForm(false);
      setSujo(false);
      load();
    } finally {
      setCriando(false);
    }
  }

  async function handleEfetivar(item: TransferenciaBancaria) {
    if (salvando) return;
    setSalvando(true);
    try {
      // O servidor debita a origem e credita o destino lendo o saldo do banco.
      await salvarTransferencia({ ...item, status: 'EFETIVADA' });
      toast.success('Transferência efetivada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao efetivar transferência');
    } finally {
      setSalvando(false);
      setConfirmacao(null);
      load();
    }
  }

  async function handleCancelar(item: TransferenciaBancaria) {
    if (salvando) return;
    const efetivada = item.status === 'EFETIVADA';
    setSalvando(true);
    try {
      // Sair de EFETIVADA faz o servidor reverter o movimento de saldo.
      await salvarTransferencia({ ...item, status: 'CANCELADA' });
      toast.success(efetivada ? 'Transferência estornada' : 'Transferência cancelada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar transferência');
    } finally {
      setSalvando(false);
      setConfirmacao(null);
      load();
    }
  }

  async function handleDelete(item: TransferenciaBancaria) {
    if (salvando) return;
    const efetivada = item.status === 'EFETIVADA';
    setSalvando(true);
    try {
      await excluirTransferencia(item.id);
      toast.success(efetivada ? 'Transferência excluída e saldos estornados' : 'Transferência excluída');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao excluir transferência');
    } finally {
      setSalvando(false);
      setConfirmacao(null);
      load();
    }
  }

  const totalPendente = somaPor(items.filter(i => i.status === 'PENDENTE'), i => i.valor);
  const totalEfetivada = somaPor(items.filter(i => i.status === 'EFETIVADA'), i => i.valor);
  const qtdPendente = items.filter(i => i.status === 'PENDENTE').length;
  const qtdEfetivada = items.filter(i => i.status === 'EFETIVADA').length;

  const estado: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : erro ? 'erro' : 'ok';

  const filtradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    return items.filter(item => {
      if (statusFiltro !== STATUS_TODOS && item.status !== statusFiltro) return false;
      if (!termo) return true;
      const alvo = normalizar(
        `${item.conta_origem_nome} ${item.conta_destino_nome} ${item.descricao}`,
      );
      return alvo.includes(termo);
    });
  }, [items, busca, statusFiltro]);

  const ordenadas = useMemo(
    () => [...filtradas].sort((a, b) => b.data.localeCompare(a.data)),
    [filtradas],
  );

  const totalDoRecorte = somaPor(filtradas, i => i.valor);
  const filtrosAtivos = (busca.trim() ? 1 : 0) + (statusFiltro !== STATUS_TODOS ? 1 : 0);

  function limparFiltros() {
    setBusca('');
    setStatusFiltro(STATUS_TODOS);
  }

  const vazio: EmptyLessonProps =
    filtrosAtivos > 0
      ? {
          motivo: 'sem-resultado',
          titulo: 'Nenhuma transferência com esse filtro',
          oQueE:
            'As transferências existem, mas nenhuma combina com a busca e a situação escolhidas agora.',
          acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limparFiltros },
        }
      : {
          motivo: 'sem-dado',
          titulo: 'Nenhuma transferência registrada ainda',
          oQueE:
            'Aqui fica o dinheiro que sai de uma conta da agência e entra em outra. Não é receita nem despesa: é o mesmo dinheiro mudando de lugar.',
          comoComeca: [
            'Escolha a conta de onde o dinheiro sai e a conta que vai receber.',
            'Escreva o valor e a data em que a transferência acontece.',
            'A transferência nasce em aberto. Só quando você efetiva é que os dois saldos mudam.',
          ],
          acao: { rotulo: 'Nova transferência', onClick: openNew },
        };

  const colunas: FinColuna<TransferenciaBancaria>[] = [
    {
      id: 'data',
      cabecalho: 'Data',
      tipo: 'data',
      sortable: true,
      minWidth: 92,
      valor: item => item.data,
    },
    {
      id: 'transferencia',
      cabecalho: 'Transferência',
      tipo: 'texto',
      sortable: true,
      minWidth: 260,
      acessor: item => `${item.conta_origem_nome} ${item.conta_destino_nome}`,
      render: item => (
        <span className="flex min-w-0 flex-col gap-[var(--fin-s-1)]">
          <span className="fin-t-body-strong flex min-w-0 items-center gap-[var(--fin-s-1)] text-[var(--fin-text)]">
            <span className="min-w-0 truncate">{nomeDaConta(item.conta_origem_nome)}</span>
            <span className="sr-only">para</span>
            <ArrowRight aria-hidden="true" className="size-3 shrink-0 text-[var(--fin-text-3)]" />
            <span className="min-w-0 truncate">{nomeDaConta(item.conta_destino_nome)}</span>
          </span>
          {item.descricao ? (
            <span className="fin-t-caption truncate text-[var(--fin-text-3)]">{item.descricao}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'valor',
      cabecalho: 'Valor',
      tipo: 'dinheiro',
      sortable: true,
      minWidth: 128,
      valor: item => item.valor,
    },
    {
      id: 'status',
      cabecalho: 'Situação',
      tipo: 'status',
      sortable: true,
      dominio: 'transferencia',
      valor: item => item.status,
    },
    {
      id: 'acoes',
      cabecalho: 'Ações',
      tipo: 'acoes',
      minWidth: 232,
      render: item => (
        <>
          {item.status === 'PENDENTE' ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={salvando}
                aria-label={`Efetivar a transferência ${trajeto(item)}`}
                onClick={() => setConfirmacao({ tipo: 'efetivar', item })}
                className={ACAO_DE_LINHA_TEXTO}
              >
                Efetivar
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={salvando}
                aria-label={`Cancelar a transferência ${trajeto(item)}`}
                onClick={() => setConfirmacao({ tipo: 'cancelar', item })}
                className={ACAO_DE_LINHA_TEXTO}
              >
                Cancelar
              </Button>
            </>
          ) : null}

          {/* Estorno: sair de EFETIVADA devolve o valor à conta de origem */}
          {item.status === 'EFETIVADA' ? (
            <Button
              type="button"
              variant="outline"
              disabled={salvando}
              aria-label={`Estornar a transferência ${trajeto(item)}`}
              onClick={() => setConfirmacao({ tipo: 'cancelar', item })}
              className={ACAO_DE_LINHA_TEXTO}
            >
              <Undo2 aria-hidden="true" className="size-4" />
              Estornar
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={salvando}
            aria-label={`Excluir a transferência ${trajeto(item)}, situação ${rotuloStatus('transferencia', item.status)}`}
            onClick={() => setConfirmacao({ tipo: 'excluir', item })}
            className={`${ACAO_DE_LINHA_ICONE} text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]`}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </>
      ),
    },
  ];

  const alvo = confirmacao?.item ?? null;
  const alvoEfetivada = alvo?.status === 'EFETIVADA';

  const detalhesDoAlvo = alvo
    ? [
        { rotulo: 'Sai de', valor: nomeDaConta(alvo.conta_origem_nome) },
        { rotulo: 'Entra em', valor: nomeDaConta(alvo.conta_destino_nome) },
        { rotulo: 'Valor', valor: <Money valor={alvo.valor} size="strong" estado="ok" /> },
        { rotulo: 'Situação', valor: rotuloStatus('transferencia', alvo.status) },
      ]
    : undefined;

  const TITULO_CONFIRMACAO: Record<Confirmacao['tipo'], string> = {
    efetivar: 'Efetivar esta transferência',
    cancelar: alvoEfetivada ? 'Estornar esta transferência' : 'Cancelar esta transferência',
    excluir: 'Excluir esta transferência',
  };

  const TEXTO_CONFIRMACAO: Record<Confirmacao['tipo'], string> = {
    efetivar:
      'O valor sai da conta de origem e entra na conta de destino. Os dois saldos mudam na hora.',
    cancelar: alvoEfetivada
      ? 'O valor volta para a conta de origem e sai da conta de destino. A transferência fica marcada como cancelada.'
      : 'A transferência fica marcada como cancelada e não vai mais ser efetivada. Nenhum saldo muda, porque o valor ainda não saiu da conta de origem.',
    excluir: alvoEfetivada
      ? 'A transferência sai da lista e os saldos das duas contas são estornados.'
      : 'A transferência sai da lista. Nenhum saldo muda, porque ela ainda não foi efetivada.',
  };

  const ROTULO_CONFIRMACAO: Record<Confirmacao['tipo'], string> = {
    efetivar: 'Efetivar transferência',
    cancelar: alvoEfetivada ? 'Estornar transferência' : 'Marcar como cancelada',
    excluir: 'Excluir transferência',
  };

  const mostraPrevia =
    confirmacao !== null && (confirmacao.tipo === 'efetivar' || alvoEfetivada);

  return (
    <div className="w-full px-[var(--fin-page-pad)] py-[var(--fin-s-5)]">
      <div className="mx-auto flex w-full max-w-[var(--fin-page-max)] flex-col gap-[var(--fin-s-5)]">
        <div className="pb-[var(--fin-s-4)]">
          <PageHeader
            titulo="Transferências entre contas"
            subtitulo="Dinheiro que sai de uma conta da agência e entra em outra. Não é receita nem despesa."
            acaoPrimaria={{ rotulo: 'Nova transferência', icone: Plus, onClick: openNew }}
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
                {[0, 1].map(i => (
                  <div
                    key={i}
                    className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]"
                  >
                    <span className="block h-3 w-32 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                    <span className="block h-8 w-52 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                    <span className="block h-3 w-40 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                  </div>
                ))}
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
            <div className="flex flex-col gap-[var(--fin-s-4)]">
              <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-2">
                <MetricCard
                  rotulo="Em aberto"
                  valor={totalPendente}
                  estado="ok"
                  emphasis="destaque"
                  contexto={
                    qtdPendente === 1
                      ? '1 transferência esperando para ser efetivada'
                      : `${qtdPendente} transferências esperando para serem efetivadas`
                  }
                  explicacao="Soma das transferências que ainda não foram efetivadas. Enquanto estão em aberto, nenhum saldo muda."
                />
                <MetricCard
                  rotulo="Efetivadas"
                  valor={totalEfetivada}
                  estado="ok"
                  contexto={
                    qtdEfetivada === 1
                      ? '1 transferência já efetivada, com o saldo das duas contas atualizado'
                      : `${qtdEfetivada} transferências já efetivadas, com o saldo das contas atualizado`
                  }
                  explicacao="Soma das transferências que já saíram de uma conta e entraram em outra."
                />
              </div>

              {contas.length > 0 ? (
                <section
                  aria-labelledby={TITULO_SALDOS_ID}
                  className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]"
                >
                  <h2 id={TITULO_SALDOS_ID} className="fin-t-overline text-[var(--fin-text-3)]">
                    Saldo das contas hoje
                  </h2>
                  <ul className="flex flex-wrap gap-[var(--fin-s-2)]">
                    {contas.map(c => (
                      <li
                        key={c.id}
                        className="flex min-w-0 flex-col gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]"
                      >
                        <span className="fin-t-caption truncate text-[var(--fin-text-2)]">{c.nome}</span>
                        <Money
                          valor={c.saldo_atual}
                          size="strong"
                          align="esquerda"
                          estado="ok"
                          tone={c.saldo_atual < 0 ? 'negativo' : 'neutro'}
                          className="min-w-0"
                        />
                      </li>
                    ))}
                  </ul>
                  <p className="fin-t-caption text-[var(--fin-text-3)]">
                    Uma transferência efetivada tira o valor de uma destas contas e coloca em outra. O
                    total em caixa da agência continua o mesmo.
                  </p>
                </section>
              ) : null}
            </div>

            {items.length > 0 ? (
              <FilterBar
                busca={{
                  valor: busca,
                  onChange: setBusca,
                  placeholder: 'Buscar por conta de origem, destino ou descrição',
                }}
                selects={[
                  {
                    id: 'filtro-situacao-transferencia',
                    rotulo: 'Situação',
                    valor: statusFiltro,
                    onChange: setStatusFiltro,
                    opcoes: [
                      { valor: STATUS_TODOS, rotulo: 'Todas as situações' },
                      ...STATUS_OPCOES.map(s => ({
                        valor: s,
                        rotulo: rotuloStatus('transferencia', s),
                      })),
                    ],
                  },
                ]}
                resumo={{
                  exibidos: filtradas.length,
                  total: items.length,
                  substantivo: 'transferências',
                  soma: totalDoRecorte,
                }}
                ativos={filtrosAtivos}
                onLimpar={limparFiltros}
              />
            ) : null}

            <FinTable
              linhas={ordenadas}
              colunas={colunas}
              chave={item => item.id}
              estado="ok"
              vazio={vazio}
              totais={[
                {
                  colunaId: 'valor',
                  valor: totalDoRecorte,
                  rotulo:
                    filtrosAtivos > 0
                      ? 'Total das transferências filtradas'
                      : 'Total das transferências listadas',
                },
              ]}
            />
          </div>
        </DataState>
      </div>

      <RecordSheet
        aberto={showForm}
        onOpenChange={setShowForm}
        titulo="Nova transferência"
        descricao="A transferência nasce em aberto. Os saldos só mudam quando você efetiva."
        sujo={sujo}
        largura={480}
        acaoPrimaria={{ rotulo: 'Criar transferência', onClick: handleSave, carregando: criando }}
        resumo={
          <PreviaDeSaldos
            contas={contas}
            origemId={contaOrigemId}
            destinoId={contaDestinoId}
            valor={valor}
            sentido="aplicar"
          />
        }
      >
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <Field rotulo="Conta de origem" obrigatorio erro={erroOrigem}>
            {a => (
              <Select
                value={contaOrigemId}
                onValueChange={v => {
                  setContaOrigemId(String(v ?? ''));
                  setSujo(true);
                }}
              >
                <SelectTrigger
                  id={a.id}
                  aria-invalid={a['aria-invalid'] || undefined}
                  aria-describedby={a['aria-describedby']}
                  className={CONTROLE_FORMULARIO}
                >
                  <SelectValue>
                    {() => {
                      const escolhida = contas.find(c => c.id === contaOrigemId);
                      return escolhida ? (
                        escolhida.nome
                      ) : (
                        <span className="text-[var(--fin-text-3)]">Escolha a conta</span>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {contas.map(c => (
                    <SelectItem key={c.id} value={c.id} className="fin-t-body">
                      <span className="flex w-full items-baseline justify-between gap-[var(--fin-s-3)]">
                        <span className="min-w-0 truncate">{c.nome}</span>
                        <Money
                          valor={c.saldo_atual}
                          size="caption"
                          estado="ok"
                          tone="suave"
                          className="min-w-0"
                        />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field
            rotulo="Conta de destino"
            obrigatorio
            ajuda="Precisa ser diferente da conta de origem."
            erro={erroDestino}
          >
            {a => (
              <Select
                value={contaDestinoId}
                onValueChange={v => {
                  setContaDestinoId(String(v ?? ''));
                  setSujo(true);
                }}
              >
                <SelectTrigger
                  id={a.id}
                  aria-invalid={a['aria-invalid'] || undefined}
                  aria-describedby={a['aria-describedby']}
                  className={CONTROLE_FORMULARIO}
                >
                  <SelectValue>
                    {() => {
                      const escolhida = contas.find(c => c.id === contaDestinoId);
                      return escolhida ? (
                        escolhida.nome
                      ) : (
                        <span className="text-[var(--fin-text-3)]">Escolha a conta</span>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {contas.filter(c => c.id !== contaOrigemId).map(c => (
                    <SelectItem key={c.id} value={c.id} className="fin-t-body">
                      <span className="flex w-full items-baseline justify-between gap-[var(--fin-s-3)]">
                        <span className="min-w-0 truncate">{c.nome}</span>
                        <Money
                          valor={c.saldo_atual}
                          size="caption"
                          estado="ok"
                          tone="suave"
                          className="min-w-0"
                        />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <MoneyField
            rotulo="Valor"
            obrigatorio
            valor={valor}
            onChange={v => {
              setValor(round2(v));
              setSujo(true);
            }}
            erro={erroValor}
            ajuda="Quanto sai da conta de origem e entra na conta de destino."
          />

          <Field rotulo="Data da transferência">
            {a => (
              <Input
                {...a}
                aria-invalid={a['aria-invalid'] || undefined}
                type="date"
                value={data}
                onChange={e => {
                  setData(e.target.value);
                  setSujo(true);
                }}
                className={`${CONTROLE_FORMULARIO} tabular-nums`}
              />
            )}
          </Field>

          <Field rotulo="Descrição" ajuda="Ajuda a reconhecer a transferência no extrato depois.">
            {a => (
              <Input
                {...a}
                aria-invalid={a['aria-invalid'] || undefined}
                value={descricao}
                onChange={e => {
                  setDescricao(e.target.value);
                  setSujo(true);
                }}
                placeholder="Reforço de caixa para pagar fornecedores"
                className={CONTROLE_FORMULARIO}
              />
            )}
          </Field>
        </div>
      </RecordSheet>

      {confirmacao ? (
        <ConfirmDialog
          aberto
          onOpenChange={aberto => {
            if (!aberto) setConfirmacao(null);
          }}
          titulo={TITULO_CONFIRMACAO[confirmacao.tipo]}
          oQueVaiAcontecer={TEXTO_CONFIRMACAO[confirmacao.tipo]}
          detalhes={detalhesDoAlvo}
          previa={
            mostraPrevia && alvo ? (
              <PreviaDeSaldos
                contas={contas}
                origemId={alvo.conta_origem_id}
                destinoId={alvo.conta_destino_id}
                valor={alvo.valor}
                sentido={confirmacao.tipo === 'efetivar' ? 'aplicar' : 'reverter'}
              />
            ) : undefined
          }
          confirmarRotulo={ROTULO_CONFIRMACAO[confirmacao.tipo]}
          tone={confirmacao.tipo === 'excluir' ? 'destrutivo' : 'padrao'}
          processando={salvando}
          onConfirmar={() => {
            if (confirmacao.tipo === 'efetivar') return handleEfetivar(confirmacao.item);
            if (confirmacao.tipo === 'cancelar') return handleCancelar(confirmacao.item);
            return handleDelete(confirmacao.item);
          }}
        />
      ) : null}
    </div>
  );
}
