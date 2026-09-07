'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { PlanoContas, NaturezaCusto, getPlanoContasPadrao } from '@/lib/crm-types';
import { loadEntities, saveEntity, deleteEntity } from '@/lib/crm-storage';
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
import { Jargao } from '@/components/fin/Jargao';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { StatusChip, statusChipVariants } from '@/components/fin/StatusChip';
import { cn } from '@/lib/utils';

const TIPO_LABEL: Record<PlanoContas['tipo'], string> = {
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
  TRANSFERENCIA: 'Transferência',
};

/** Indentação de 16px por nível (seção 9.9). Sem estilo inline. */
const INDENTACAO: Record<number, string> = {
  0: '',
  1: 'pl-4',
  2: 'pl-8',
  3: 'pl-12',
};

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] focus-visible:ring-0';

/**
 * min-h acompanha o h porque o SelectTrigger carrega `data-[size=default]:h-8`,
 * que tem especificidade maior que uma classe de altura solta. Sem isso o alvo
 * de toque cai para 32px (seção 11, A5).
 */
const CONTROLE = cn(
  'h-11 min-h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10 lg:min-h-10',
  FOCO,
);

const CONTROLE_TEXTO = cn(CONTROLE, 'fin-t-body');
const CONTROLE_CODIGO = cn(CONTROLE, 'fin-t-code');

const ACAO_LINHA = cn(
  'size-11 rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] shadow-none hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] lg:size-10',
  FOCO,
);

/** Sentinela apenas de tela: o valor gravado continua sendo null. */
const SEM_NATUREZA = 'SEM_NATUREZA';

function getLevel(codigo: string): number {
  return (codigo.match(/\./g) || []).length;
}

type FormState = {
  codigo: string;
  nome: string;
  tipo: PlanoContas['tipo'];
  natureza_custo: NaturezaCusto | null;
  is_custo_comercial: boolean;
};

// Default DESPESA (caso mais comum no dia a dia, aluguel, salários,
// impostos, etc.). Antes default RECEITA fazia categorias novas
// sumirem do dropdown de contas a pagar.
const EMPTY_FORM: FormState = { codigo: '', nome: '', tipo: 'DESPESA', natureza_custo: null, is_custo_comercial: false };

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function CartaoContagem({
  rotulo,
  valor,
  contexto,
  destaque = false,
}: {
  rotulo: React.ReactNode;
  valor: number;
  contexto: string;
  destaque?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[var(--fin-s-1)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]">
      <h3 className="fin-t-overline flex items-center gap-[var(--fin-s-1)] text-[var(--fin-text-3)]">{rotulo}</h3>
      <p
        className={cn(
          'tabular-nums text-[var(--fin-text)]',
          destaque ? 'fin-t-metric' : 'fin-t-metric-sm',
        )}
      >
        {valor.toLocaleString('pt-BR')}
      </p>
      <p className="fin-t-caption text-[var(--fin-text-2)]">{contexto}</p>
    </div>
  );
}

function EsqueletoResumo() {
  return (
    <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)]"
        >
          <span className="block h-3 w-24 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-7 w-16 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-3 w-40 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
        </div>
      ))}
    </div>
  );
}

export default function PlanoContasPage() {
  const [items, setItems] = useState<PlanoContas[]>([]);
  const [estado, setEstado] = useState<'carregando' | 'erro' | 'ok'>('carregando');
  const [erro, setErro] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formInicial, setFormInicial] = useState<FormState>(EMPTY_FORM);
  const [salvando, setSalvando] = useState(false);
  const [loadingPadrao, setLoadingPadrao] = useState(false);
  const [confirmarPadrao, setConfirmarPadrao] = useState(false);
  const [paraExcluir, setParaExcluir] = useState<PlanoContas | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [filterTipo, setFilterTipo] = useState<PlanoContas['tipo'] | 'TODOS'>('TODOS');

  const totalPadrao = useMemo(() => getPlanoContasPadrao().length, []);

  async function load() {
    setEstado('carregando');
    try {
      const data = await loadEntities<PlanoContas>('plano-contas');
      setItems(data);
      setErro(null);
      setAtualizadoEm(new Date());
      setEstado('ok');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A consulta não respondeu.');
      setEstado('erro');
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCarregarPadrao() {
    setLoadingPadrao(true);
    const padrao = getPlanoContasPadrao();
    for (const conta of padrao) {
      const novaConta: PlanoContas = { ...conta, id: generateId() };
      await saveEntity('plano-contas', novaConta);
    }
    setLoadingPadrao(false);
    setConfirmarPadrao(false);
    load();
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setFormInicial(EMPTY_FORM);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(item: PlanoContas) {
    const inicial: FormState = {
      codigo: item.codigo,
      nome: item.nome,
      tipo: item.tipo,
      natureza_custo: item.natureza_custo ?? null,
      is_custo_comercial: item.is_custo_comercial ?? false,
    };
    setForm(inicial);
    setFormInicial(inicial);
    setEditId(item.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.codigo || !form.nome) return;
    setSalvando(true);
    try {
      if (editId) {
        const existing = items.find(i => i.id === editId)!;
        const updated: PlanoContas = {
          ...existing,
          codigo: form.codigo,
          nome: form.nome,
          tipo: form.tipo,
          natureza_custo: form.tipo === 'DESPESA' ? form.natureza_custo : null,
          is_custo_comercial: form.tipo === 'DESPESA' ? form.is_custo_comercial : false,
        };
        await deleteEntity('plano-contas', editId);
        await saveEntity('plano-contas', updated);
      } else {
        const nova: PlanoContas = {
          id: generateId(),
          codigo: form.codigo,
          nome: form.nome,
          tipo: form.tipo,
          categoria_pai_id: null,
          natureza_custo: form.tipo === 'DESPESA' ? form.natureza_custo : null,
          is_custo_comercial: form.tipo === 'DESPESA' ? form.is_custo_comercial : false,
          ativo: true,
        };
        await saveEntity('plano-contas', nova);
      }
      setShowForm(false);
      setEditId(null);
      load();
    } finally {
      setSalvando(false);
    }
  }

  async function handleDelete(id: string) {
    setExcluindo(true);
    try {
      await deleteEntity('plano-contas', id);
      setParaExcluir(null);
      load();
    } finally {
      setExcluindo(false);
    }
  }

  const sorted = [...items].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
  const filtered = sorted.filter(i => filterTipo === 'TODOS' || i.tipo === filterTipo);

  const totalReceitas = items.filter(i => i.tipo === 'RECEITA').length;
  const totalDespesas = items.filter(i => i.tipo === 'DESPESA').length;
  const totalComerciais = items.filter(i => i.is_custo_comercial).length;

  const sujo = JSON.stringify(form) !== JSON.stringify(formInicial);
  const semCategorias = items.length === 0;

  const colunas: FinColuna<PlanoContas>[] = [
    {
      id: 'codigo',
      cabecalho: 'Código',
      tipo: 'texto',
      minWidth: 72,
      render: (r) => <span className="fin-t-code text-[var(--fin-text-3)]">{r.codigo}</span>,
    },
    {
      id: 'nome',
      cabecalho: 'Categoria',
      tipo: 'texto',
      minWidth: 240,
      render: (r) => {
        const nivel = getLevel(r.codigo);
        const grupo = nivel === 0;
        return (
          <span
            className={cn(
              'block',
              INDENTACAO[Math.min(nivel, 3)],
              grupo ? 'fin-t-body-strong text-[var(--fin-text)]' : 'fin-t-body text-[var(--fin-text-2)]',
            )}
          >
            {r.nome}
          </span>
        );
      },
    },
    {
      id: 'tipo',
      cabecalho: 'Entra ou sai',
      tipo: 'texto',
      minWidth: 120,
      prioridade: 2,
      render: (r) => (
        <span className={statusChipVariants({ tone: 'neutro' })}>{TIPO_LABEL[r.tipo]}</span>
      ),
    },
    {
      id: 'classificacao',
      cabecalho: 'Tipo de despesa',
      tipo: 'texto',
      minWidth: 200,
      prioridade: 1,
      render: (r) => {
        if (r.natureza_custo || r.is_custo_comercial) {
          return (
            <span className="flex flex-wrap items-center gap-[var(--fin-s-1)]">
              {r.natureza_custo ? <StatusChip valor={r.natureza_custo} dominio="natureza" /> : null}
              {r.is_custo_comercial ? (
                <span className={statusChipVariants({ tone: 'info' })}>Custo para conseguir cliente</span>
              ) : null}
            </span>
          );
        }
        return (
          <span className="fin-t-caption text-[var(--fin-text-3)]">
            {r.tipo === 'DESPESA' ? 'Sem classificação' : 'Não se aplica'}
          </span>
        );
      },
    },
    {
      id: 'acoes',
      cabecalho: 'Ações',
      tipo: 'acoes',
      render: (r) => (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Editar a categoria ${r.nome}`}
            className={ACAO_LINHA}
            onClick={() => openEdit(r)}
          >
            <Pencil aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Excluir a categoria ${r.nome}`}
            className={cn(ACAO_LINHA, 'hover:bg-[var(--fin-negative-soft)] hover:text-[var(--fin-negative-text)]')}
            onClick={() => setParaExcluir(r)}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </>
      ),
    },
  ];

  return (
    <div className="bg-[var(--fin-bg)] text-[var(--fin-text)]">
      <div className="mx-auto w-full max-w-[var(--fin-page-max)] px-[var(--fin-page-pad)] py-[var(--fin-s-5)]">

        <PageHeader
          titulo="Categorias de entrada e saída"
          subtitulo={
            <Jargao
              comum="Como você organiza cada entrada e cada saída da agência"
              tecnico="Plano de contas"
              explicacao="É a lista de categorias que você escolhe ao lançar uma conta a pagar ou a receber. Ela é a base do resultado do mês."
            />
          }
          atualizadoEm={atualizadoEm}
          onRecarregar={load}
          acoesSecundarias={[
            { rotulo: 'Carregar categorias padrão', onClick: () => setConfirmarPadrao(true) },
          ]}
          acaoPrimaria={{ rotulo: 'Nova categoria', icone: Plus, onClick: openNew }}
        />

        <div className="mt-[var(--fin-s-6)] flex flex-col gap-[var(--fin-s-5)]">

          <DataState
            estado={estado}
            erro={erro ? { mensagem: erro, onTentarDeNovo: load } : null}
            esqueleto={<EsqueletoResumo />}
          >
            <div className="grid grid-cols-1 gap-[var(--fin-s-4)] sm:grid-cols-2">
              <CartaoContagem
                rotulo="Categorias cadastradas"
                valor={items.length}
                contexto={`${totalReceitas} de receita e ${totalDespesas} de despesa`}
                destaque
              />
              <CartaoContagem
                rotulo={
                  <Jargao
                    comum="Custo para conseguir cliente"
                    tecnico="CAC"
                    explicacao="Reúne as despesas que existem para trazer cliente novo, como anúncios, comissão de vendedor e feiras."
                    comoCalcula="Soma dessas despesas no período dividida pelo número de clientes novos."
                  />
                }
                valor={totalComerciais}
                contexto="despesas marcadas para entrar nesse cálculo"
              />
            </div>
          </DataState>

          {/* Sem contagem antes de haver o que contar: nada de "0 de 0" no
              carregamento nem sobre a tela vazia (seção 8.6). */}
          {estado === 'ok' && items.length > 0 ? (
            <FilterBar
              selects={[
                {
                  id: 'filtro-tipo',
                  rotulo: 'Tipo',
                  valor: filterTipo,
                  opcoes: [
                    { valor: 'TODOS', rotulo: 'Todas' },
                    { valor: 'RECEITA', rotulo: 'Receita' },
                    { valor: 'DESPESA', rotulo: 'Despesa' },
                    { valor: 'TRANSFERENCIA', rotulo: 'Transferência' },
                  ],
                  onChange: (v) => setFilterTipo(v as PlanoContas['tipo'] | 'TODOS'),
                },
              ]}
              resumo={{
                exibidos: filtered.length,
                total: items.length,
                substantivo: items.length === 1 ? 'categoria' : 'categorias',
              }}
              ativos={filterTipo === 'TODOS' ? 0 : 1}
              onLimpar={() => setFilterTipo('TODOS')}
            />
          ) : null}

          <FinTable
            linhas={filtered}
            colunas={colunas}
            chave={(r) => r.id}
            densidade="compacta"
            estado={estado}
            erro={erro ? { mensagem: erro, onTentarDeNovo: load } : null}
            onLinhaClick={openEdit}
            vazio={
              semCategorias
                ? {
                    motivo: 'sem-dado',
                    titulo: 'Nenhuma categoria cadastrada ainda',
                    oQueE:
                      'As categorias dizem de onde vem cada entrada e para onde vai cada saída. Sem elas, o resultado do mês não consegue separar aluguel de comissão.',
                    comoComeca: [
                      'Carregue as categorias padrão para começar com a estrutura pronta.',
                      'Renomeie o que sua agência chama de outro jeito.',
                      'Marque como custo para conseguir cliente as despesas de venda e de marketing.',
                    ],
                    acao: { rotulo: 'Carregar categorias padrão', onClick: () => setConfirmarPadrao(true) },
                    acaoSecundaria: { rotulo: 'Nova categoria', onClick: openNew },
                  }
                : {
                    motivo: 'sem-resultado',
                    titulo: 'Nenhuma categoria com esse tipo',
                    oQueE: `O filtro escondeu as ${items.length} categorias já cadastradas. Troque o tipo ou limpe o filtro para ver todas de novo.`,
                    acaoSecundaria: { rotulo: 'Limpar filtros', onClick: () => setFilterTipo('TODOS') },
                  }
            }
          />
        </div>
      </div>

      <RecordSheet
        aberto={showForm}
        onOpenChange={(aberto) => {
          setShowForm(aberto);
          if (!aberto) setEditId(null);
        }}
        titulo={editId ? 'Editar categoria' : 'Nova categoria'}
        descricao="O código define a posição na hierarquia. Um ponto a mais é um nível a mais."
        sujo={sujo}
        resumo={
          form.tipo === 'DESPESA'
            ? 'Esta categoria vai aparecer na hora de lançar uma conta a pagar.'
            : form.tipo === 'RECEITA'
              ? 'Esta categoria vai aparecer na hora de lançar uma conta a receber.'
              : 'Esta categoria vai aparecer na hora de lançar uma transferência entre contas.'
        }
        acaoPrimaria={{
          rotulo: editId ? 'Salvar categoria' : 'Criar categoria',
          onClick: handleSave,
          carregando: salvando,
          desabilitado: !form.codigo || !form.nome,
        }}
      >
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <Field rotulo="Código" obrigatorio ajuda="Ex.: 1.1.01. Cada ponto cria um nível abaixo.">
            {(a) => (
              <Input
                id={a.id}
                aria-invalid={a['aria-invalid']}
                aria-describedby={a['aria-describedby']}
                value={form.codigo}
                onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
                placeholder="1.1.01"
                className={CONTROLE_CODIGO}
              />
            )}
          </Field>

          <Field rotulo="Nome" obrigatorio ajuda="O nome que sua equipe usa no dia a dia.">
            {(a) => (
              <Input
                id={a.id}
                aria-invalid={a['aria-invalid']}
                aria-describedby={a['aria-describedby']}
                value={form.nome}
                onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="Comissão de aéreo"
                className={CONTROLE_TEXTO}
              />
            )}
          </Field>

          <Field rotulo="Entra ou sai" ajuda="Define em qual tela a categoria vai aparecer.">
            {(a) => (
              <Select
                value={form.tipo}
                onValueChange={(v) => setForm(f => ({ ...f, tipo: v as PlanoContas['tipo'] }))}
              >
                <SelectTrigger
                  id={a.id}
                  aria-label="Entra ou sai"
                  aria-describedby={a['aria-describedby']}
                  className={CONTROLE_TEXTO}
                >
                  <SelectValue>{() => TIPO_LABEL[form.tipo]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RECEITA" className="fin-t-body">Receita</SelectItem>
                  <SelectItem value="DESPESA" className="fin-t-body">Despesa</SelectItem>
                  <SelectItem value="TRANSFERENCIA" className="fin-t-body">Transferência</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>

          {/* Campo condicional: não é renderizado quando não se aplica (seção 8.5). */}
          {form.tipo === 'DESPESA' && (
            <div className="flex flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)]">
              <Field
                rotulo="Tipo de despesa"
                ajuda="Fixa é a que se repete todo mês. Variável muda com o volume de vendas."
              >
                {(a) => (
                  <Select
                    value={form.natureza_custo ?? SEM_NATUREZA}
                    onValueChange={(v) =>
                      setForm(f => ({
                        ...f,
                        natureza_custo: v === SEM_NATUREZA ? null : (v as NaturezaCusto),
                      }))
                    }
                  >
                    <SelectTrigger
                      id={a.id}
                      aria-label="Tipo de despesa"
                      aria-describedby={a['aria-describedby']}
                      className={CONTROLE_TEXTO}
                    >
                      <SelectValue>
                        {() =>
                          form.natureza_custo === 'FIXO'
                            ? 'Fixo'
                            : form.natureza_custo === 'VARIAVEL'
                              ? 'Variável'
                              : form.natureza_custo === 'COMPRA_UNICA'
                                ? 'Compra única'
                                : 'Sem classificação'
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_NATUREZA} className="fin-t-body">Sem classificação</SelectItem>
                      <SelectItem value="FIXO" className="fin-t-body">Fixo</SelectItem>
                      <SelectItem value="VARIAVEL" className="fin-t-body">Variável</SelectItem>
                      <SelectItem value="COMPRA_UNICA" className="fin-t-body">Compra única</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <Field
                rotulo="Custo para conseguir cliente"
                ajuda="Marque quando a despesa existe para trazer cliente novo, como anúncio ou comissão de vendedor."
              >
                {(a) => (
                  <Button
                    id={a.id}
                    type="button"
                    variant="ghost"
                    role="switch"
                    aria-checked={form.is_custo_comercial}
                    aria-label="Custo para conseguir cliente"
                    aria-describedby={a['aria-describedby']}
                    onClick={() => setForm(f => ({ ...f, is_custo_comercial: !f.is_custo_comercial }))}
                    className={cn(
                      'fin-t-body h-11 w-full justify-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border px-3 shadow-none lg:h-10',
                      FOCO,
                      form.is_custo_comercial
                        ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]'
                        : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text-2)]',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 shrink-0 rounded-[var(--fin-r-dot)]',
                        form.is_custo_comercial ? 'bg-[var(--fin-accent)]' : 'bg-[var(--fin-border-strong)]',
                      )}
                    />
                    {form.is_custo_comercial ? 'Sim, entra no cálculo' : 'Não entra no cálculo'}
                  </Button>
                )}
              </Field>
            </div>
          )}
        </div>
      </RecordSheet>

      <ConfirmDialog
        aberto={confirmarPadrao}
        onOpenChange={setConfirmarPadrao}
        titulo="Carregar as categorias padrão?"
        oQueVaiAcontecer="As categorias padrão são criadas junto com as que você já tem. Nada do que existe hoje é alterado ou apagado."
        detalhes={[
          { rotulo: 'Categorias que serão criadas', valor: String(totalPadrao) },
          { rotulo: 'Categorias que você já tem', valor: String(items.length) },
        ]}
        previa="Entre elas vêm as despesas marcadas como custo para conseguir cliente, usadas no cálculo do CAC."
        confirmarRotulo="Carregar categorias"
        processando={loadingPadrao}
        onConfirmar={handleCarregarPadrao}
      />

      <ConfirmDialog
        aberto={paraExcluir !== null}
        onOpenChange={(aberto) => { if (!aberto) setParaExcluir(null); }}
        titulo="Excluir esta categoria?"
        oQueVaiAcontecer="A categoria deixa de aparecer na hora de lançar contas. Os lançamentos já feitos com ela continuam como estão."
        detalhes={
          paraExcluir
            ? [
                { rotulo: 'Código', valor: paraExcluir.codigo },
                { rotulo: 'Categoria', valor: paraExcluir.nome },
                { rotulo: 'Entra ou sai', valor: TIPO_LABEL[paraExcluir.tipo] },
              ]
            : undefined
        }
        confirmarRotulo="Excluir categoria"
        tone="destrutivo"
        processando={excluindo}
        onConfirmar={() => { if (paraExcluir) return handleDelete(paraExcluir.id); }}
      />
    </div>
  );
}
