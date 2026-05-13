'use client';

import { useEffect, useState } from 'react';
import { PlanoContas, NaturezaCusto, getPlanoContasPadrao } from '@/lib/crm-types';
import { loadEntities, saveEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, X, Check, Trash2, Download, BookOpen, ChevronRight, Target } from 'lucide-react';

const TIPO_BADGE: Record<PlanoContas['tipo'], string> = {
  RECEITA: 'bg-[var(--t-green-bg)] text-[var(--t-green)]',
  DESPESA: 'bg-[var(--t-red-bg)] text-[var(--t-red)]',
  TRANSFERENCIA: 'bg-[var(--t-blue-bg)] text-[var(--t-blue)]',
};

const TIPO_DOT: Record<PlanoContas['tipo'], string> = {
  RECEITA: 'bg-[var(--t-green)]',
  DESPESA: 'bg-[var(--t-red)]',
  TRANSFERENCIA: 'bg-[var(--t-blue)]',
};

const NATUREZA_LABEL: Record<string, string> = {
  FIXO: 'Fixo',
  VARIAVEL: 'Variável',
  COMPRA_UNICA: 'Compra Única',
};

const NATUREZA_COLORS: Record<string, string> = {
  FIXO: 'bg-[var(--t-blue-bg)] text-[var(--t-blue)]',
  VARIAVEL: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
  COMPRA_UNICA: 'bg-purple-500/10 text-purple-400',
};

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

// Default DESPESA (caso mais comum no dia a dia — aluguel, salários,
// impostos, etc.). Antes default RECEITA fazia categorias novas
// sumirem do dropdown de contas a pagar.
const EMPTY_FORM: FormState = { codigo: '', nome: '', tipo: 'DESPESA', natureza_custo: null, is_custo_comercial: false };

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export default function PlanoContasPage() {
  const [items, setItems] = useState<PlanoContas[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loadingPadrao, setLoadingPadrao] = useState(false);
  const [filterTipo, setFilterTipo] = useState<PlanoContas['tipo'] | 'TODOS'>('TODOS');

  async function load() {
    setLoading(true);
    const data = await loadEntities<PlanoContas>('plano-contas');
    setItems(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCarregarPadrao() {
    if (!confirm('Isso irá adicionar as contas padrão (incluindo categorias de custos comerciais para o CAC). Deseja continuar?')) return;
    setLoadingPadrao(true);
    const padrao = getPlanoContasPadrao();
    for (const conta of padrao) {
      const novaConta: PlanoContas = { ...conta, id: generateId() };
      await saveEntity('plano-contas', novaConta);
    }
    setLoadingPadrao(false);
    load();
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(item: PlanoContas) {
    setForm({
      codigo: item.codigo,
      nome: item.nome,
      tipo: item.tipo,
      natureza_custo: item.natureza_custo ?? null,
      is_custo_comercial: item.is_custo_comercial ?? false,
    });
    setEditId(item.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.codigo || !form.nome) return;
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
  }

  async function handleDelete(id: string) {
    if (!confirm('Confirmar exclusão?')) return;
    await deleteEntity('plano-contas', id);
    load();
  }

  const sorted = [...items].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
  const filtered = sorted.filter(i => filterTipo === 'TODOS' || i.tipo === filterTipo);

  const totalReceitas = items.filter(i => i.tipo === 'RECEITA').length;
  const totalDespesas = items.filter(i => i.tipo === 'DESPESA').length;
  const totalComerciais = items.filter(i => i.is_custo_comercial).length;

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        <MinimalPageHead
          title="Plano de contas"
          meta={<p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>Estrutura hierárquica de categorias financeiras</p>}
          actions={
            <>
              <button
                onClick={handleCarregarPadrao}
                disabled={loadingPadrao}
                className="h-[34px] px-3 text-[12px] border transition-colors hover:bg-[var(--ink-surface-2)] disabled:opacity-50"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
              >
                <Download className="w-3.5 h-3.5 inline mr-2" />
                {loadingPadrao ? 'Carregando…' : 'Carregar padrão'}
              </button>
              <button
                onClick={openNew}
                className="h-[34px] px-3 text-[12px] font-medium"
                style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}
              >
                <Plus className="w-3.5 h-3.5 inline mr-2" /> Nova conta
              </button>
            </>
          }
        />

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 text-center">
              <p className="text-[var(--t-green)] text-2xl font-bold">{totalReceitas}</p>
              <p className="text-[var(--t-text-muted)] text-xs uppercase mt-1">Receitas</p>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 text-center">
              <p className="text-[var(--t-red)] text-2xl font-bold">{totalDespesas}</p>
              <p className="text-[var(--t-text-muted)] text-xs uppercase mt-1">Despesas</p>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 text-center">
              <p className="text-[var(--t-amber)] text-2xl font-bold">{totalComerciais}</p>
              <p className="text-[var(--t-text-muted)] text-xs uppercase mt-1">Custos Comerciais (CAC)</p>
            </CardContent>
          </Card>
        </div>

        {/* Inline Form */}
        {showForm && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-green)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-green)] text-base">
                {editId ? 'Editar Conta' : 'Nova Conta'}
              </CardTitle>
              <button onClick={() => setShowForm(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Código *</label>
                  <Input
                    value={form.codigo}
                    onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
                    placeholder="Ex: 1.1.01"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Nome *</label>
                  <Input
                    value={form.nome}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    placeholder="Nome da conta"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Tipo</label>
                  <select
                    value={form.tipo}
                    onChange={e => setForm(f => ({ ...f, tipo: e.target.value as PlanoContas['tipo'] }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="RECEITA">Receita</option>
                    <option value="DESPESA">Despesa</option>
                    <option value="TRANSFERENCIA">Transferência</option>
                  </select>
                </div>
              </div>

              {/* Classification fields — only for DESPESA */}
              {form.tipo === 'DESPESA' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 p-3 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)]">
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Natureza do Custo</label>
                    <select
                      value={form.natureza_custo || ''}
                      onChange={e => setForm(f => ({ ...f, natureza_custo: (e.target.value || null) as NaturezaCusto | null }))}
                      className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                    >
                      <option value="">Não classificado</option>
                      <option value="FIXO">Fixo</option>
                      <option value="VARIAVEL">Variável</option>
                      <option value="COMPRA_UNICA">Compra Única</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3 pt-4">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.is_custo_comercial}
                        onChange={e => setForm(f => ({ ...f, is_custo_comercial: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-[var(--t-border)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--t-green)]"></div>
                    </label>
                    <div>
                      <span className="text-sm text-[var(--t-text)]">Custo Comercial</span>
                      <p className="text-xs text-[var(--t-text-muted)]">Incluir no cálculo do CAC</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleSave}
                  className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold"
                >
                  <Check className="w-4 h-4 mr-1" /> {editId ? 'Salvar' : 'Criar'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
                >
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filter */}
        <div className="flex gap-2 flex-wrap">
          {(['TODOS', 'RECEITA', 'DESPESA', 'TRANSFERENCIA'] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilterTipo(t)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterTipo === t
                  ? 'bg-[var(--t-green)] text-white dark:text-[#0a0a14]'
                  : 'bg-[var(--t-surface)] text-[var(--t-text-secondary)] hover:text-[var(--t-text)] shadow-[var(--t-card-shadow)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tree View */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[var(--t-green)]" />
              Hierarquia ({filtered.length} contas)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="text-[var(--t-text-secondary)] text-sm p-6">Carregando...</p>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-[var(--t-text-muted)] text-sm">Nenhuma conta cadastrada.</p>
                <p className="text-[var(--t-text-muted)] text-xs mt-1">Use &quot;Carregar Padrão&quot; para importar o plano de contas base.</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--t-border)]">
                {filtered.map(item => {
                  const level = getLevel(item.codigo);
                  const isGroup = level === 0 || (level === 1 && !item.codigo.includes('.'));
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--t-surface-hover)] transition-colors group"
                      style={{ paddingLeft: `${16 + level * 20}px` }}
                    >
                      {level > 0 && (
                        <ChevronRight className="w-3 h-3 text-[var(--t-text-muted)] shrink-0" />
                      )}
                      <div className={`w-2 h-2 rounded-full shrink-0 ${TIPO_DOT[item.tipo]}`} />
                      <span className={`font-mono text-xs text-[var(--t-text-muted)] w-16 shrink-0 ${isGroup ? 'font-bold text-[var(--t-text-secondary)]' : ''}`}>
                        {item.codigo}
                      </span>
                      <span className={`flex-1 text-sm ${isGroup ? 'font-semibold text-[var(--t-text)]' : 'text-[var(--t-text-secondary)]'}`}>
                        {item.nome}
                      </span>

                      {/* Classification badges */}
                      {item.natureza_custo && (
                        <Badge className={`${NATUREZA_COLORS[item.natureza_custo]} border-0 text-[10px] px-1.5`}>
                          {NATUREZA_LABEL[item.natureza_custo]}
                        </Badge>
                      )}
                      {item.is_custo_comercial && (
                        <Badge className="bg-[var(--t-amber-bg)] text-[var(--t-amber)] border-0 text-[10px] px-1.5 flex items-center gap-0.5">
                          <Target className="w-2.5 h-2.5" /> CAC
                        </Badge>
                      )}

                      <Badge className={`${TIPO_BADGE[item.tipo]} border-0 text-xs opacity-0 group-hover:opacity-100 transition-opacity`}>
                        {item.tipo}
                      </Badge>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEdit(item)}
                          className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] h-6 px-2 text-xs"
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDelete(item.id)}
                          className="border-[var(--t-red)]/30 text-[var(--t-red)] hover:bg-[var(--t-red-bg)] h-6 px-1.5"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <MinimalFooter pageId="plano de contas" />
      </div>
    </div>
  );
}
