'use client';

import { useEffect, useState } from 'react';
import { PlanoContas, getPlanoContasPadrao } from '@/lib/crm-types';
import { loadEntities, saveEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, X, Check, Trash2, Download, BookOpen, ChevronRight } from 'lucide-react';

const TIPO_BADGE: Record<PlanoContas['tipo'], string> = {
  RECEITA: 'bg-green-100 text-green-800',
  DESPESA: 'bg-red-100 text-red-800',
  TRANSFERENCIA: 'bg-blue-100 text-blue-800',
};

const TIPO_DOT: Record<PlanoContas['tipo'], string> = {
  RECEITA: 'bg-green-400',
  DESPESA: 'bg-red-400',
  TRANSFERENCIA: 'bg-blue-400',
};

function getLevel(codigo: string): number {
  return (codigo.match(/\./g) || []).length;
}

function getIndent(codigo: string): string {
  const level = getLevel(codigo);
  return `${level * 20}px`;
}

type FormState = {
  codigo: string;
  nome: string;
  tipo: PlanoContas['tipo'];
};

const EMPTY_FORM: FormState = { codigo: '', nome: '', tipo: 'RECEITA' };

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
    if (!confirm('Isso irá adicionar as contas padrão. Deseja continuar?')) return;
    setLoadingPadrao(true);
    const padrao = getPlanoContasPadrao();
    for (const conta of padrao) {
      const novaConta: PlanoContas = {
        ...conta,
        id: generateId(),
      };
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
    setForm({ codigo: item.codigo, nome: item.nome, tipo: item.tipo });
    setEditId(item.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.codigo || !form.nome) return;
    if (editId) {
      const existing = items.find(i => i.id === editId)!;
      const updated: PlanoContas = { ...existing, ...form };
      // Use saveEntity with PUT logic via updateEntity — but only saveEntity is imported per spec.
      // We'll delete old and save new to simulate update.
      await deleteEntity('plano-contas', editId);
      await saveEntity('plano-contas', updated);
    } else {
      const nova: PlanoContas = {
        id: generateId(),
        ...form,
        categoria_pai_id: null,
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
  const totalTransf = items.filter(i => i.tipo === 'TRANSFERENCIA').length;

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#d4a853]">Plano de Contas</h1>
            <p className="text-gray-400 text-sm mt-1">Estrutura hierárquica de categorias financeiras</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleCarregarPadrao}
              disabled={loadingPadrao}
              variant="outline"
              className="border-[#d4a853]/50 text-[#d4a853] hover:bg-[#d4a853]/10"
            >
              <Download className="w-4 h-4 mr-2" />
              {loadingPadrao ? 'Carregando...' : 'Carregar Padrão'}
            </Button>
            <Button
              onClick={openNew}
              className="bg-[#d4a853] hover:bg-[#c49843] text-[#1a1a2e] font-semibold"
            >
              <Plus className="w-4 h-4 mr-2" /> Nova Conta
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-[#16213e] border-green-500/30">
            <CardContent className="p-4 text-center">
              <p className="text-green-400 text-2xl font-bold">{totalReceitas}</p>
              <p className="text-gray-400 text-xs uppercase mt-1">Receitas</p>
            </CardContent>
          </Card>
          <Card className="bg-[#16213e] border-red-500/30">
            <CardContent className="p-4 text-center">
              <p className="text-red-400 text-2xl font-bold">{totalDespesas}</p>
              <p className="text-gray-400 text-xs uppercase mt-1">Despesas</p>
            </CardContent>
          </Card>
          <Card className="bg-[#16213e] border-blue-500/30">
            <CardContent className="p-4 text-center">
              <p className="text-blue-400 text-2xl font-bold">{totalTransf}</p>
              <p className="text-gray-400 text-xs uppercase mt-1">Transferências</p>
            </CardContent>
          </Card>
        </div>

        {/* Inline Form */}
        {showForm && (
          <Card className="bg-[#16213e] border-[#d4a853]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[#d4a853] text-base">
                {editId ? 'Editar Conta' : 'Nova Conta'}
              </CardTitle>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Código *</label>
                  <Input
                    value={form.codigo}
                    onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
                    placeholder="Ex: 1.1.01"
                    className="bg-[#1a1a2e] border-gray-600 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Nome *</label>
                  <Input
                    value={form.nome}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    placeholder="Nome da conta"
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Tipo</label>
                  <select
                    value={form.tipo}
                    onChange={e => setForm(f => ({ ...f, tipo: e.target.value as PlanoContas['tipo'] }))}
                    className="w-full bg-[#1a1a2e] border border-gray-600 rounded px-3 py-2 text-sm text-white"
                  >
                    <option value="RECEITA">Receita</option>
                    <option value="DESPESA">Despesa</option>
                    <option value="TRANSFERENCIA">Transferência</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleSave}
                  className="bg-[#d4a853] hover:bg-[#c49843] text-[#1a1a2e] font-semibold"
                >
                  <Check className="w-4 h-4 mr-1" /> {editId ? 'Salvar' : 'Criar'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  className="border-gray-600 text-gray-300 hover:bg-gray-700"
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
                  ? 'bg-[#d4a853] text-[#1a1a2e]'
                  : 'bg-[#16213e] text-gray-400 hover:text-white border border-gray-600'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tree View */}
        <Card className="bg-[#16213e] border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#d4a853]" />
              Hierarquia ({filtered.length} contas)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="text-gray-400 text-sm p-6">Carregando...</p>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-500 text-sm">Nenhuma conta cadastrada.</p>
                <p className="text-gray-600 text-xs mt-1">Use "Carregar Padrão" para importar o plano de contas base.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-700/50">
                {filtered.map(item => {
                  const level = getLevel(item.codigo);
                  const isGroup = level === 0 || (level === 1 && !item.codigo.includes('.'));
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#1a1a2e]/40 transition-colors group"
                      style={{ paddingLeft: `${16 + level * 20}px` }}
                    >
                      {level > 0 && (
                        <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />
                      )}
                      <div className={`w-2 h-2 rounded-full shrink-0 ${TIPO_DOT[item.tipo]}`} />
                      <span className={`font-mono text-xs text-gray-500 w-16 shrink-0 ${isGroup ? 'font-bold text-gray-400' : ''}`}>
                        {item.codigo}
                      </span>
                      <span className={`flex-1 text-sm ${isGroup ? 'font-semibold text-white' : 'text-gray-300'}`}>
                        {item.nome}
                      </span>
                      <Badge className={`${TIPO_BADGE[item.tipo]} border-0 text-xs opacity-0 group-hover:opacity-100 transition-opacity`}>
                        {item.tipo}
                      </Badge>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEdit(item)}
                          className="border-gray-600 text-gray-300 hover:bg-gray-700 h-6 px-2 text-xs"
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDelete(item.id)}
                          className="border-red-700 text-red-400 hover:bg-red-900/30 h-6 px-1.5"
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
      </div>
    </div>
  );
}
