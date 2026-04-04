'use client';

import { useEffect, useState } from 'react';
import { PlanoComissao, FaixaComissao, TipoBaseComissao, TipoProdutoVenda, createPlanoComissao } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Plus, X, Check, Trash2, Settings2, Percent, Layers, ChevronDown, ChevronUp,
} from 'lucide-react';

const BASES: Record<TipoBaseComissao, string> = {
  MARKUP: 'Markup (Venda - Custo)',
  VALOR_VENDA: 'Valor da Venda',
  COMISSAO_FORNECEDOR: 'Comissão do Fornecedor',
  LUCRO: 'Lucro Líquido',
};

const TIPOS_PRODUTO: TipoProdutoVenda[] = ['AEREO', 'HOTEL', 'PACOTE', 'SEGURO', 'RECEPTIVO', 'CRUZEIRO', 'CARRO', 'INGRESSO', 'GRUPO', 'OUTROS'];

export default function PlanosComissaoPage() {
  const [planos, setPlanos] = useState<PlanoComissao[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [baseCalculo, setBaseCalculo] = useState<TipoBaseComissao>('MARKUP');
  const [percentualPadrao, setPercentualPadrao] = useState(10);
  const [faixas, setFaixas] = useState<FaixaComissao[]>([]);
  const [regrasProduto, setRegrasProduto] = useState<Array<{ tipo_produto: string; percentual: number }>>([]);

  async function load() {
    setLoading(true);
    const data = await loadEntities<PlanoComissao>('planos-comissao');
    setPlanos(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setNome('');
    setDescricao('');
    setBaseCalculo('MARKUP');
    setPercentualPadrao(10);
    setFaixas([]);
    setRegrasProduto([]);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(p: PlanoComissao) {
    setNome(p.nome);
    setDescricao(p.descricao);
    setBaseCalculo(p.base_calculo);
    setPercentualPadrao(p.percentual_padrao);
    setFaixas([...p.faixas]);
    setRegrasProduto([...p.regras_produto]);
    setEditId(p.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!nome) return;
    if (editId) {
      const existing = planos.find(p => p.id === editId)!;
      await updateEntity('planos-comissao', {
        ...existing, nome, descricao, base_calculo: baseCalculo,
        percentual_padrao: percentualPadrao, faixas, regras_produto: regrasProduto,
      });
    } else {
      const novo: PlanoComissao = {
        ...createPlanoComissao(), nome, descricao, base_calculo: baseCalculo,
        percentual_padrao: percentualPadrao, faixas, regras_produto: regrasProduto,
      };
      await saveEntity('planos-comissao', novo);
    }
    setShowForm(false);
    setEditId(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir plano de comissão?')) return;
    await deleteEntity('planos-comissao', id);
    load();
  }

  async function handleToggle(p: PlanoComissao) {
    await updateEntity('planos-comissao', { ...p, ativo: !p.ativo });
    load();
  }

  function addFaixa() {
    const last = faixas[faixas.length - 1];
    setFaixas([...faixas, { de: last ? last.ate : 0, ate: 0, percentual: percentualPadrao }]);
  }

  function addRegraProduto() {
    const usados = regrasProduto.map(r => r.tipo_produto);
    const proximo = TIPOS_PRODUTO.find(t => !usados.includes(t)) || 'AEREO';
    setRegrasProduto([...regrasProduto, { tipo_produto: proximo, percentual: percentualPadrao }]);
  }

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Planos de Comissão</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Configure regras de comissionamento por vendedor</p>
          </div>
          <Button onClick={openNew} className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold">
            <Plus className="w-4 h-4 mr-2" /> Novo Plano
          </Button>
        </div>

        {/* Form */}
        {showForm && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-green)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-green)] text-base flex items-center gap-2">
                <Settings2 className="w-4 h-4" /> {editId ? 'Editar Plano' : 'Novo Plano de Comissão'}
              </CardTitle>
              <button onClick={() => setShowForm(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Nome *</label>
                  <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Padrão 10%" className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Base de Cálculo</label>
                  <select value={baseCalculo} onChange={e => setBaseCalculo(e.target.value as TipoBaseComissao)}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
                    {Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">% Padrão</label>
                  <Input type="number" min={0} max={100} step={0.5} value={percentualPadrao} onChange={e => setPercentualPadrao(parseFloat(e.target.value) || 0)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]" />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Descrição</label>
                <Input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descrição do plano"
                  className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]" />
              </div>

              {/* Faixas progressivas */}
              <div className="p-4 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)]">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-[var(--t-text)]">Faixas Progressivas (opcional)</p>
                  <Button size="sm" variant="outline" onClick={addFaixa} className="border-[var(--t-border)] text-[var(--t-text-secondary)] h-7 text-xs">
                    <Plus className="w-3 h-3 mr-1" /> Faixa
                  </Button>
                </div>
                {faixas.length === 0 ? (
                  <p className="text-xs text-[var(--t-text-muted)]">Sem faixas — será usado o percentual padrão ({percentualPadrao}%).</p>
                ) : (
                  <div className="space-y-2">
                    {faixas.map((f, i) => (
                      <div key={i} className="grid grid-cols-4 gap-2 items-end">
                        <div>
                          <label className="text-[10px] text-[var(--t-text-muted)]">De (R$)</label>
                          <Input type="number" min={0} value={f.de} onChange={e => { const u = [...faixas]; u[i] = { ...u[i], de: parseFloat(e.target.value) || 0 }; setFaixas(u); }}
                            className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] h-8 text-xs" />
                        </div>
                        <div>
                          <label className="text-[10px] text-[var(--t-text-muted)]">Até (R$)</label>
                          <Input type="number" min={0} value={f.ate} onChange={e => { const u = [...faixas]; u[i] = { ...u[i], ate: parseFloat(e.target.value) || 0 }; setFaixas(u); }}
                            className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] h-8 text-xs" />
                        </div>
                        <div>
                          <label className="text-[10px] text-[var(--t-text-muted)]">%</label>
                          <Input type="number" min={0} max={100} step={0.5} value={f.percentual} onChange={e => { const u = [...faixas]; u[i] = { ...u[i], percentual: parseFloat(e.target.value) || 0 }; setFaixas(u); }}
                            className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] h-8 text-xs" />
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setFaixas(faixas.filter((_, j) => j !== i))}
                          className="border-[var(--t-red)]/30 text-[var(--t-red)] h-8 px-2">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Regras por produto */}
              <div className="p-4 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)]">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-[var(--t-text)]">% por Tipo de Produto (opcional)</p>
                  <Button size="sm" variant="outline" onClick={addRegraProduto} className="border-[var(--t-border)] text-[var(--t-text-secondary)] h-7 text-xs">
                    <Plus className="w-3 h-3 mr-1" /> Regra
                  </Button>
                </div>
                {regrasProduto.length === 0 ? (
                  <p className="text-xs text-[var(--t-text-muted)]">Sem regras específicas — todos os produtos usam o % padrão.</p>
                ) : (
                  <div className="space-y-2">
                    {regrasProduto.map((r, i) => (
                      <div key={i} className="grid grid-cols-3 gap-2 items-end">
                        <div>
                          <label className="text-[10px] text-[var(--t-text-muted)]">Produto</label>
                          <select value={r.tipo_produto} onChange={e => { const u = [...regrasProduto]; u[i] = { ...u[i], tipo_produto: e.target.value }; setRegrasProduto(u); }}
                            className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-2 py-1.5 text-xs text-[var(--t-text)]">
                            {TIPOS_PRODUTO.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-[var(--t-text-muted)]">%</label>
                          <Input type="number" min={0} max={100} step={0.5} value={r.percentual} onChange={e => { const u = [...regrasProduto]; u[i] = { ...u[i], percentual: parseFloat(e.target.value) || 0 }; setRegrasProduto(u); }}
                            className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] h-8 text-xs" />
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setRegrasProduto(regrasProduto.filter((_, j) => j !== i))}
                          className="border-[var(--t-red)]/30 text-[var(--t-red)] h-8 px-2">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSave} className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold">
                  <Check className="w-4 h-4 mr-1" /> {editId ? 'Salvar' : 'Criar'}
                </Button>
                <Button variant="outline" onClick={() => setShowForm(false)} className="border-[var(--t-border)] text-[var(--t-text-secondary)]">Cancelar</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* List */}
        <div className="space-y-3">
          {loading ? (
            <p className="text-[var(--t-text-secondary)] text-sm">Carregando...</p>
          ) : planos.length === 0 ? (
            <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
              <CardContent className="py-8 text-center">
                <Layers className="w-10 h-10 text-[var(--t-text-muted)] mx-auto mb-3" />
                <p className="text-[var(--t-text-muted)] text-sm">Nenhum plano de comissão criado.</p>
              </CardContent>
            </Card>
          ) : (
            planos.map(p => (
              <Card key={p.id} className={`bg-[var(--t-surface)] border-[var(--t-border)] ${!p.ativo ? 'opacity-50' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                      {expandedId === p.id ? <ChevronUp className="w-4 h-4 text-[var(--t-text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--t-text-muted)]" />}
                      <div>
                        <h3 className="font-medium text-[var(--t-text)]">{p.nome}</h3>
                        <p className="text-xs text-[var(--t-text-muted)]">{p.descricao || BASES[p.base_calculo]}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-[var(--t-green-bg)] text-[var(--t-green)] border-0 text-sm font-mono">
                        <Percent className="w-3 h-3 mr-0.5" />{p.percentual_padrao}
                      </Badge>
                      <Badge className={`${p.ativo ? 'bg-[var(--t-green-bg)] text-[var(--t-green)]' : 'bg-[var(--t-surface)] text-[var(--t-text-muted)]'} border-0 text-xs`}>
                        {p.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => handleToggle(p)}
                        className="border-[var(--t-border)] text-[var(--t-text-secondary)] h-7 px-2 text-xs">
                        {p.ativo ? 'Desativar' : 'Ativar'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(p)}
                        className="border-[var(--t-border)] text-[var(--t-text-secondary)] h-7 px-2 text-xs">Editar</Button>
                      <Button size="sm" variant="outline" onClick={() => handleDelete(p.id)}
                        className="border-[var(--t-red)]/30 text-[var(--t-red)] h-7 px-2">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {expandedId === p.id && (
                    <div className="mt-4 pt-4 border-t border-[var(--t-border)] grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-[var(--t-text-muted)] uppercase mb-2">Base de Cálculo</p>
                        <p className="text-sm text-[var(--t-text)]">{BASES[p.base_calculo]}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--t-text-muted)] uppercase mb-2">Faixas ({p.faixas.length})</p>
                        {p.faixas.length === 0 ? (
                          <p className="text-xs text-[var(--t-text-muted)]">Percentual fixo</p>
                        ) : (
                          <div className="space-y-1">
                            {p.faixas.map((f, i) => (
                              <p key={i} className="text-xs text-[var(--t-text-secondary)]">
                                R$ {f.de.toLocaleString()} — R$ {f.ate.toLocaleString()}: <span className="text-[var(--t-green)] font-medium">{f.percentual}%</span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                      {p.regras_produto.length > 0 && (
                        <div className="col-span-2">
                          <p className="text-xs text-[var(--t-text-muted)] uppercase mb-2">Regras por Produto</p>
                          <div className="flex flex-wrap gap-2">
                            {p.regras_produto.map((r, i) => (
                              <Badge key={i} className="bg-[var(--t-surface)] text-[var(--t-text-secondary)] border border-[var(--t-border)] text-xs">
                                {r.tipo_produto}: {r.percentual}%
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
