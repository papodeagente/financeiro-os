'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Banknote, Building2, CreditCard, PiggyBank, Plus, Pencil, TrendingUp, Trash2 } from 'lucide-react';

import { ContaBancaria } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { somaPor } from '@/lib/money';

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

type FormState = {
  nome: string;
  tipo: ContaBancaria['tipo'];
  banco: string;
  agencia: string;
  conta: string;
  saldo_inicial: number;
};

const EMPTY_FORM: FormState = {
  nome: '',
  tipo: 'CORRENTE',
  banco: '',
  agencia: '',
  conta: '',
  saldo_inicial: 0,
};

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

function identificacaoDe(item: ContaBancaria): string {
  const partes: string[] = [];
  if (item.agencia) partes.push(`Ag ${item.agencia}`);
  if (item.conta) partes.push(`Conta ${item.conta}`);
  return partes.join(' · ');
}

function sublinhaDe(item: ContaBancaria): string {
  return [item.banco, identificacaoDe(item)].filter(Boolean).join(' · ');
}

function contagemDeContas(n: number): string {
  return n === 1 ? '1 conta cadastrada' : `${n} contas cadastradas`;
}

export default function ContasBancariasPage() {
  const [items, setItems] = useState<ContaBancaria[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [sujo, setSujo] = useState(false);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [aExcluir, setAExcluir] = useState<ContaBancaria | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const [busca, setBusca] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState<string>(TIPO_TODOS);

  async function load() {
    setLoading(true);
    try {
      const data = await loadEntities<ContaBancaria>('contas-bancarias');
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
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowForm(true);
    setSujo(false);
    setErroNome(null);
  }

  function openEdit(item: ContaBancaria) {
    setForm({
      nome: item.nome,
      tipo: item.tipo,
      banco: item.banco,
      agencia: item.agencia,
      conta: item.conta,
      saldo_inicial: item.saldo_inicial,
    });
    setEditId(item.id);
    setShowForm(true);
    setSujo(false);
    setErroNome(null);
  }

  async function handleSave() {
    if (!form.nome) {
      setErroNome('Escreva o nome da conta para poder salvar.');
      return;
    }
    setErroNome(null);
    setSalvando(true);
    try {
      if (editId) {
        const existing = items.find(i => i.id === editId)!;
        const updated: ContaBancaria = {
          ...existing,
          nome: form.nome,
          tipo: form.tipo,
          banco: form.banco,
          agencia: form.agencia,
          conta: form.conta,
          saldo_inicial: form.saldo_inicial,
        };
        await updateEntity('contas-bancarias', updated);
      } else {
        const nova: ContaBancaria = {
          ...createNewConta(),
          nome: form.nome,
          tipo: form.tipo,
          banco: form.banco,
          agencia: form.agencia,
          conta: form.conta,
          saldo_inicial: form.saldo_inicial,
          saldo_atual: form.saldo_inicial,
        };
        await saveEntity('contas-bancarias', nova);
      }
      setShowForm(false);
      setEditId(null);
      setSujo(false);
      toast.success(editId ? 'Conta atualizada.' : 'Conta criada.');
      load();
    } catch {
      toast.error('Não foi possível salvar a conta. Nada foi alterado.');
    } finally {
      setSalvando(false);
    }
  }

  async function handleDelete(id: string) {
    setExcluindo(true);
    try {
      await deleteEntity('contas-bancarias', id);
      setAExcluir(null);
      toast.success('Conta excluída.');
      load();
    } catch {
      toast.error('Não foi possível excluir a conta. Nada foi alterado.');
    } finally {
      setExcluindo(false);
    }
  }

  const totalSaldo = somaPor(items, i => i.saldo_atual);

  const estado: 'carregando' | 'erro' | 'ok' = loading ? 'carregando' : erro ? 'erro' : 'ok';

  const filtradas = useMemo(() => {
    const termo = normalizar(busca.trim());
    return items.filter(item => {
      if (tipoFiltro !== TIPO_TODOS && item.tipo !== tipoFiltro) return false;
      if (!termo) return true;
      const alvo = normalizar(`${item.nome} ${item.banco} ${item.agencia} ${item.conta}`);
      return alvo.includes(termo);
    });
  }, [items, busca, tipoFiltro]);

  const totalDoRecorte = somaPor(filtradas, i => i.saldo_atual);
  const filtrosAtivos = (busca.trim() ? 1 : 0) + (tipoFiltro !== TIPO_TODOS ? 1 : 0);

  function limparFiltros() {
    setBusca('');
    setTipoFiltro(TIPO_TODOS);
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

  const colunas: FinColuna<ContaBancaria>[] = [
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
            <span className="fin-t-body-strong truncate text-[var(--fin-text)]">{item.nome}</span>
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
      acessor: item => item.banco,
      render: item =>
        item.banco ? (
          <span>{item.banco}</span>
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
    {
      id: 'saldo',
      cabecalho: 'Saldo',
      tipo: 'dinheiro',
      sortable: true,
      minWidth: 140,
      valor: item => item.saldo_atual,
      tone: item => (item.saldo_atual < 0 ? 'negativo' : 'neutro'),
      sub: item => {
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
                <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]">
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
                    rotulo="Saldo total em caixa"
                    valor={totalSaldo}
                    estado="ok"
                    emphasis="destaque"
                    tone={totalSaldo < 0 ? 'negativo' : 'neutro'}
                    contexto={contagemDeContas(items.length)}
                    explicacao="Saldo inicial mais recebido menos pago, somando todas as contas."
                  />
                </div>
                <p className="fin-t-caption text-[var(--fin-text-3)]">
                  Como o saldo de cada conta é formado: saldo inicial mais recebido menos pago.
                </p>
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
                  rotulo: filtrosAtivos > 0 ? 'Total das contas filtradas' : 'Total em caixa',
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

          <Field rotulo="Banco">
            {a => (
              <Input
                id={a.id}
                aria-describedby={a['aria-describedby']}
                value={form.banco}
                onChange={e => atualizarForm({ banco: e.target.value })}
                placeholder="Bradesco, Itaú, Nubank"
                className={CONTROLE_FORMULARIO}
              />
            )}
          </Field>

          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2">
            <Field rotulo="Agência">
              {a => (
                <Input
                  id={a.id}
                  aria-describedby={a['aria-describedby']}
                  value={form.agencia}
                  onChange={e => atualizarForm({ agencia: e.target.value })}
                  placeholder="0000-0"
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
                  onChange={e => atualizarForm({ conta: e.target.value })}
                  placeholder="00000000-0"
                  className={`${CONTROLE_FORMULARIO} tabular-nums`}
                />
              )}
            </Field>
          </div>

          <MoneyField
            rotulo="Saldo inicial"
            valor={form.saldo_inicial}
            onChange={v => atualizarForm({ saldo_inicial: v })}
            ajuda="Copie o saldo que o aplicativo do banco mostra hoje."
          />
        </div>
      </RecordSheet>

      <ConfirmDialog
        aberto={aExcluir !== null}
        onOpenChange={aberto => {
          if (!aberto) setAExcluir(null);
        }}
        titulo="Excluir esta conta bancária"
        oQueVaiAcontecer="A conta sai da lista e o saldo dela deixa de entrar no total em caixa. Os lançamentos já feitos continuam onde estão."
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
          if (aExcluir) return handleDelete(aExcluir.id);
        }}
      />
    </div>
  );
}
