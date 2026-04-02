'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ChevronDown, ChevronUp, ArrowLeft, Save, Search, Plane, Hotel } from 'lucide-react';
import { FlightSearchModal } from '@/components/FlightSearchModal';
import { HotelSearchModal } from '@/components/HotelSearchModal';
import { formatFlightForVenda } from '@/lib/flight-data-mapper';
import { formatHotelForVenda } from '@/lib/hotel-data-mapper';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import type { GooglePlace } from '@/lib/hotel-data-mapper';
import {
  VendaCRM,
  ProdutoVenda,
  Cliente,
  createVendaCRM,
  createProdutoVenda,
} from '@/lib/crm-types';
import { GrupoViagem } from '@/lib/types';
import { loadEntities, saveEntity } from '@/lib/crm-storage';
import { loadGrupos } from '@/lib/storage';
import { getProdutoGrupo } from '@/lib/financial-calculations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const TIPOS_PRODUTO = [
  'AEREO', 'HOTEL', 'PACOTE', 'SEGURO', 'RECEPTIVO', 'CRUZEIRO', 'CARRO', 'INGRESSO', 'GRUPO', 'OUTROS',
] as const;

const FORMAS_PAGAMENTO = [
  { value: 'AVISTA_PIX', label: 'À Vista / PIX' },
  { value: 'CARTAO', label: 'Cartão' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'FATURADO', label: 'Faturado' },
  { value: 'MISTO', label: 'Misto' },
];

const inputClass =
  'bg-[#0f0f1a] border-[#2a2a4e] text-white placeholder:text-gray-500 focus:border-[#d4a853]';
const labelClass = 'block text-sm text-gray-400 mb-1';
const sectionClass = 'bg-[#1a1a2e] border border-[#2a2a4e] rounded-lg p-5 mb-4';

function SectionHeader({
  title,
  open,
  onToggle,
  extra,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between cursor-pointer select-none mb-4"
      onClick={onToggle}
    >
      <h2 className="text-base font-semibold text-[#d4a853]">{title}</h2>
      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
        {extra}
        <button
          type="button"
          onClick={onToggle}
          className="text-gray-400 hover:text-white"
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export default function NovaVendaPage() {
  const router = useRouter();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [grupos, setGrupos] = useState<GrupoViagem[]>([]);
  const [clienteSearch, setClienteSearch] = useState('');
  const [showClienteList, setShowClienteList] = useState(false);
  const [saving, setSaving] = useState(false);

  const [openSections, setOpenSections] = useState({
    cliente: true,
    passageiros: true,
    produtos: true,
    totais: true,
    pagamento: true,
    obs: false,
  });

  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const numero = `V${Date.now().toString(36).toUpperCase()}`;
  const [venda, setVenda] = useState<VendaCRM>(() => createVendaCRM(numero));
  const [flightModalIdx, setFlightModalIdx] = useState<number | null>(null);
  const [hotelModalIdx, setHotelModalIdx] = useState<number | null>(null);

  useEffect(() => {
    loadEntities<Cliente>('clientes').then(setClientes);
    loadGrupos().then(setGrupos);
  }, []);

  // When a produto is set to GRUPO, allow selecting a grupo and auto-fill values
  const selectGrupoForProduto = (idx: number, grupoId: string) => {
    const grupo = grupos.find(g => g.id === grupoId);
    if (!grupo) return;
    try {
      const produto = getProdutoGrupo(grupo);
      const custoEntries = Object.values(produto.custos_por_apto) as Array<Record<string, number>>;
      const custoSgl = custoEntries.reduce((sum, entry) => sum + (entry.sgl || 0), 0);
      const vendaSgl = produto.precos.avista.sgl || 0;
      setVenda(prev => {
        const produtos = [...prev.produtos];
        produtos[idx] = {
          ...produtos[idx],
          tipo: 'GRUPO' as ProdutoVenda['tipo'],
          descricao: `Grupo: ${grupo.grp_id || 'Sem ID'} — ${grupo.origem_destino || ''}`,
          fornecedor_nome: 'Operação Própria',
          valor_custo: custoSgl,
          valor_venda: vendaSgl,
          moeda: 'BRL',
          cambio: 1,
          projeto: grupo.id,
        };
        return recalcTotais({ ...prev, produtos, tipo: 'GRUPO', grupo_id: grupo.id });
      });
    } catch {
      // If getProdutoGrupo fails, just set basic info
      setVenda(prev => {
        const produtos = [...prev.produtos];
        produtos[idx] = {
          ...produtos[idx],
          tipo: 'GRUPO' as ProdutoVenda['tipo'],
          descricao: `Grupo: ${grupo.grp_id || 'Sem ID'}`,
          projeto: grupo.id,
        };
        return { ...prev, produtos, tipo: 'GRUPO', grupo_id: grupo.id };
      });
    }
  };

  // ---- Cliente helpers ----
  const selectedCliente = clientes.find(c => c.id === venda.cliente_id);
  const clienteNome = selectedCliente
    ? selectedCliente.tipo === 'PF'
      ? selectedCliente.nome_completo
      : selectedCliente.nome_fantasia || selectedCliente.razao_social
    : '';

  const filteredClientes = clientes.filter(c => {
    const q = clienteSearch.toLowerCase();
    const nome =
      c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social;
    return nome.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  const selectCliente = (c: Cliente) => {
    const nome = c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social;
    setVenda(prev => ({ ...prev, cliente_id: c.id }));
    setClienteSearch(nome);
    setShowClienteList(false);
  };

  // ---- Passageiros ----
  const addPassageiro = () => {
    setVenda(prev => ({
      ...prev,
      passageiros: [
        ...prev.passageiros,
        { nome: '', tipo: 'ADT', documento: '', data_nascimento: '', telefone: '', email: '' },
      ],
    }));
  };

  const updatePassageiro = (idx: number, field: string, value: string) => {
    setVenda(prev => {
      const passageiros = [...prev.passageiros];
      passageiros[idx] = { ...passageiros[idx], [field]: value };
      return { ...prev, passageiros };
    });
  };

  const removePassageiro = (idx: number) => {
    setVenda(prev => ({
      ...prev,
      passageiros: prev.passageiros.filter((_, i) => i !== idx),
    }));
  };

  // ---- Produtos ----
  const addProduto = () => {
    setVenda(prev => ({ ...prev, produtos: [...prev.produtos, createProdutoVenda()] }));
  };

  const updateProduto = (idx: number, field: string, value: string | number) => {
    setVenda(prev => {
      const produtos = [...prev.produtos];
      produtos[idx] = { ...produtos[idx], [field]: value };
      return recalcTotais({ ...prev, produtos });
    });
  };

  const removeProduto = (idx: number) => {
    setVenda(prev => {
      const produtos = prev.produtos.filter((_, i) => i !== idx);
      return recalcTotais({ ...prev, produtos });
    });
  };

  // ---- Totais ----
  const recalcTotais = useCallback((v: VendaCRM): VendaCRM => {
    const custo = v.produtos.reduce((sum, p) => {
      const cambio = p.cambio || 1;
      return sum + (p.valor_custo || 0) * cambio;
    }, 0);
    const venda_total = v.produtos.reduce((sum, p) => {
      const cambio = p.cambio || 1;
      return sum + (p.valor_venda || 0) * cambio;
    }, 0);
    const markup = custo > 0 ? ((venda_total - custo) / custo) * 100 : 0;
    const valor_final = Math.max(0, venda_total - (v.desconto || 0));
    return {
      ...v,
      valor_total_custo: custo,
      valor_total_venda: venda_total,
      markup_realizado: markup,
      valor_final,
    };
  }, []);

  const setDesconto = (val: number) => {
    setVenda(prev => recalcTotais({ ...prev, desconto: val }));
  };

  // ---- Save ----
  const handleSave = async () => {
    if (!venda.cliente_id) {
      alert('Selecione um cliente.');
      return;
    }
    setSaving(true);
    try {
      await saveEntity('vendas-crm', venda);
      router.push('/vendas');
    } catch {
      alert('Erro ao salvar venda.');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f0f1a] text-white p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/vendas')}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Nova Venda</h1>
            <p className="text-gray-400 text-sm font-mono">{venda.numero}</p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#d4a853] hover:bg-[#c4953f] text-[#1a1a2e] font-semibold"
        >
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Salvando...' : 'Salvar Venda'}
        </Button>
      </div>

      {/* 1. Cliente */}
      <div className={sectionClass}>
        <SectionHeader
          title="1. Cliente"
          open={openSections.cliente}
          onToggle={() => toggleSection('cliente')}
        />
        {openSections.cliente && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative">
              <label className={labelClass}>Cliente *</label>
              <Input
                value={clienteSearch}
                onChange={e => {
                  setClienteSearch(e.target.value);
                  setShowClienteList(true);
                  if (!e.target.value) setVenda(prev => ({ ...prev, cliente_id: '' }));
                }}
                onFocus={() => setShowClienteList(true)}
                placeholder="Buscar cliente..."
                className={inputClass}
              />
              {showClienteList && clienteSearch && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-[#1a1a2e] border border-[#2a2a4e] rounded-md shadow-xl max-h-48 overflow-y-auto">
                  {filteredClientes.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-gray-400">Nenhum cliente encontrado</p>
                  ) : (
                    filteredClientes.map(c => {
                      const nome =
                        c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-[#2a2a4e] text-gray-200"
                          onMouseDown={() => selectCliente(c)}
                        >
                          <span className="font-medium">{nome}</span>
                          {c.email && (
                            <span className="text-gray-400 ml-2 text-xs">{c.email}</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            <div>
              <label className={labelClass}>Data da Venda</label>
              <Input
                type="date"
                value={venda.data_venda}
                onChange={e => setVenda(prev => ({ ...prev, data_venda: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select
                value={venda.status}
                onChange={e =>
                  setVenda(prev => ({ ...prev, status: e.target.value as VendaCRM['status'] }))
                }
                className="w-full bg-[#0f0f1a] border border-[#2a2a4e] text-white rounded-md px-3 py-2 text-sm"
              >
                <option value="ORCAMENTO">Orçamento</option>
                <option value="RESERVADO">Reservado</option>
                <option value="CONFIRMADO">Confirmado</option>
                <option value="CANCELADO">Cancelado</option>
                <option value="CONCLUIDO">Concluído</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Vendedor</label>
              <Input
                value={venda.vendedor_id}
                onChange={e => setVenda(prev => ({ ...prev, vendedor_id: e.target.value }))}
                placeholder="ID ou nome do vendedor"
                className={inputClass}
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. Passageiros */}
      <div className={sectionClass}>
        <SectionHeader
          title={`2. Passageiros (${venda.passageiros.length})`}
          open={openSections.passageiros}
          onToggle={() => toggleSection('passageiros')}
          extra={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-[#d4a853] hover:bg-[#d4a853]/10 h-7 text-xs"
              onClick={addPassageiro}
            >
              <Plus className="w-3 h-3 mr-1" /> Adicionar
            </Button>
          }
        />
        {openSections.passageiros && (
          <div className="space-y-3">
            {venda.passageiros.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-4">
                Nenhum passageiro adicionado
              </p>
            )}
            {venda.passageiros.map((p, idx) => (
              <div
                key={idx}
                className="bg-[#0f0f1a] border border-[#2a2a4e] rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <Badge className="bg-[#d4a853]/10 text-[#d4a853] border-[#d4a853]/30 text-xs">
                    Passageiro {idx + 1}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => removePassageiro(idx)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className={labelClass}>Nome</label>
                    <Input
                      value={p.nome}
                      onChange={e => updatePassageiro(idx, 'nome', e.target.value)}
                      placeholder="Nome completo"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Tipo</label>
                    <select
                      value={p.tipo}
                      onChange={e => updatePassageiro(idx, 'tipo', e.target.value)}
                      className="w-full bg-[#0f0f1a] border border-[#2a2a4e] text-white rounded-md px-3 py-2 text-sm"
                    >
                      <option value="ADT">ADT (Adulto)</option>
                      <option value="CHD">CHD (Criança)</option>
                      <option value="INF">INF (Bebê)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Documento</label>
                    <Input
                      value={p.documento}
                      onChange={e => updatePassageiro(idx, 'documento', e.target.value)}
                      placeholder="CPF / Passaporte"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Data Nascimento</label>
                    <Input
                      type="date"
                      value={p.data_nascimento}
                      onChange={e => updatePassageiro(idx, 'data_nascimento', e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Produtos */}
      <div className={sectionClass}>
        <SectionHeader
          title={`3. Produtos / Serviços (${venda.produtos.length})`}
          open={openSections.produtos}
          onToggle={() => toggleSection('produtos')}
          extra={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-[#d4a853] hover:bg-[#d4a853]/10 h-7 text-xs"
              onClick={addProduto}
            >
              <Plus className="w-3 h-3 mr-1" /> Adicionar
            </Button>
          }
        />
        {openSections.produtos && (
          <div className="space-y-4">
            {venda.produtos.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-4">
                Nenhum produto adicionado
              </p>
            )}
            {venda.produtos.map((prod, idx) => (
              <div
                key={prod.id}
                className="bg-[#0f0f1a] border border-[#2a2a4e] rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-xs">
                      Produto {idx + 1}
                    </Badge>
                    <Badge className="bg-[#2a2a4e] text-gray-300 border-[#3a3a5e] text-xs">
                      {prod.tipo}
                    </Badge>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeProduto(idx)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Base fields */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className={labelClass}>Tipo</label>
                    <select
                      value={prod.tipo}
                      onChange={e => updateProduto(idx, 'tipo', e.target.value)}
                      className="w-full bg-[#1a1a2e] border border-[#2a2a4e] text-white rounded-md px-3 py-2 text-sm"
                    >
                      {TIPOS_PRODUTO.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass}>Descrição</label>
                    <Input
                      value={prod.descricao}
                      onChange={e => updateProduto(idx, 'descricao', e.target.value)}
                      placeholder="Descrição do produto"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Fornecedor</label>
                    <Input
                      value={prod.fornecedor_nome}
                      onChange={e => updateProduto(idx, 'fornecedor_nome', e.target.value)}
                      placeholder="Nome do fornecedor"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Data Início</label>
                    <Input
                      type="date"
                      value={prod.data_inicio}
                      onChange={e => updateProduto(idx, 'data_inicio', e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Data Fim</label>
                    <Input
                      type="date"
                      value={prod.data_fim}
                      onChange={e => updateProduto(idx, 'data_fim', e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Localizador</label>
                    <Input
                      value={prod.localizador}
                      onChange={e => updateProduto(idx, 'localizador', e.target.value)}
                      placeholder="Código de reserva"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* GRUPO specific */}
                {prod.tipo === 'GRUPO' && (
                  <div className="mb-3 pt-3 border-t border-[#2a2a4e]">
                    <label className={labelClass}>Selecionar Grupo (Produto)</label>
                    <select
                      className={`w-full rounded-md px-3 py-2 text-sm ${inputClass}`}
                      value={prod.projeto || ''}
                      onChange={e => selectGrupoForProduto(idx, e.target.value)}
                    >
                      <option value="">-- Selecione um grupo --</option>
                      {grupos.map(g => (
                        <option key={g.id} value={g.id}>
                          {g.grp_id || 'Sem ID'} — {g.origem_destino || 'Sem destino'}
                        </option>
                      ))}
                    </select>
                    {prod.projeto && (
                      <p className="text-xs text-green-400 mt-1">
                        Valores preenchidos automaticamente a partir do produto do grupo
                      </p>
                    )}
                  </div>
                )}

                {/* AEREO specific */}
                {prod.tipo === 'AEREO' && (
                  <div className="mb-3 pt-3 border-t border-[#2a2a4e]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-400">Dados do voo</span>
                      <button
                        onClick={() => setFlightModalIdx(idx)}
                        className="flex items-center gap-1 px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded hover:bg-blue-500/20"
                      >
                        <Search className="w-3 h-3" /> Buscar voo via API
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>Cia Aérea</label>
                        <Input
                          value={prod.cia_aerea}
                          onChange={e => updateProduto(idx, 'cia_aerea', e.target.value)}
                          placeholder="Ex: LATAM, GOL, AZUL"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Trecho</label>
                        <Input
                          value={prod.trecho}
                          onChange={e => updateProduto(idx, 'trecho', e.target.value)}
                          placeholder="Ex: GRU-MIA"
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* HOTEL specific */}
                {prod.tipo === 'HOTEL' && (
                  <div className="mb-3 pt-3 border-t border-[#2a2a4e]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-400">Dados do hotel</span>
                      <button
                        onClick={() => setHotelModalIdx(idx)}
                        className="flex items-center gap-1 px-2 py-1 bg-emerald-500/10 text-emerald-400 text-xs rounded hover:bg-emerald-500/20"
                      >
                        <Search className="w-3 h-3" /> Buscar hotel via API
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass}>Hotel</label>
                      <Input
                        value={prod.hotel_nome}
                        onChange={e => updateProduto(idx, 'hotel_nome', e.target.value)}
                        placeholder="Nome do hotel"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Tipo de Apto</label>
                      <Input
                        value={prod.tipo_apto}
                        onChange={e => updateProduto(idx, 'tipo_apto', e.target.value)}
                        placeholder="Ex: Standard, Suite"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Regime</label>
                      <Input
                        value={prod.regime}
                        onChange={e => updateProduto(idx, 'regime', e.target.value)}
                        placeholder="Ex: Café, Meia pensão"
                        className={inputClass}
                      />
                    </div>
                    </div>
                  </div>
                )}

                {/* Valores */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-[#2a2a4e]">
                  <div>
                    <label className={labelClass}>Valor Custo</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={prod.valor_custo || ''}
                      onChange={e => updateProduto(idx, 'valor_custo', parseFloat(e.target.value) || 0)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Valor Venda</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={prod.valor_venda || ''}
                      onChange={e => updateProduto(idx, 'valor_venda', parseFloat(e.target.value) || 0)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Moeda</label>
                    <select
                      value={prod.moeda}
                      onChange={e => updateProduto(idx, 'moeda', e.target.value)}
                      className="w-full bg-[#0f0f1a] border border-[#2a2a4e] text-white rounded-md px-3 py-2 text-sm"
                    >
                      <option value="BRL">BRL</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Câmbio</label>
                    <Input
                      type="number"
                      min="1"
                      step="0.01"
                      value={prod.cambio || 1}
                      onChange={e => updateProduto(idx, 'cambio', parseFloat(e.target.value) || 1)}
                      className={inputClass}
                    />
                  </div>
                </div>

                {prod.moeda !== 'BRL' && (
                  <div className="mt-2 text-xs text-gray-400">
                    Custo em BRL:{' '}
                    <span className="text-orange-400">
                      {fmt((prod.valor_custo || 0) * (prod.cambio || 1))}
                    </span>{' '}
                    · Venda em BRL:{' '}
                    <span className="text-green-400">
                      {fmt((prod.valor_venda || 0) * (prod.cambio || 1))}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Totais */}
      <div className={sectionClass}>
        <SectionHeader
          title="4. Totais"
          open={openSections.totais}
          onToggle={() => toggleSection('totais')}
        />
        {openSections.totais && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#0f0f1a] rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">Custo Total</p>
              <p className="text-lg font-bold text-orange-400">
                {fmt(venda.valor_total_custo)}
              </p>
            </div>
            <div className="bg-[#0f0f1a] rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">Venda Total</p>
              <p className="text-lg font-bold text-blue-400">
                {fmt(venda.valor_total_venda)}
              </p>
            </div>
            <div className="bg-[#0f0f1a] rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">Markup</p>
              <p className="text-lg font-bold text-[#d4a853]">
                {venda.markup_realizado.toFixed(1)}%
              </p>
            </div>
            <div className="bg-[#0f0f1a] rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">Valor Final</p>
              <p className="text-lg font-bold text-green-400">
                {fmt(venda.valor_final)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 5. Pagamento */}
      <div className={sectionClass}>
        <SectionHeader
          title="5. Pagamento"
          open={openSections.pagamento}
          onToggle={() => toggleSection('pagamento')}
        />
        {openSections.pagamento && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Forma de Pagamento</label>
              <select
                value={venda.forma_pagamento}
                onChange={e =>
                  setVenda(prev => ({
                    ...prev,
                    forma_pagamento: e.target.value as VendaCRM['forma_pagamento'],
                  }))
                }
                className="w-full bg-[#0f0f1a] border border-[#2a2a4e] text-white rounded-md px-3 py-2 text-sm"
              >
                {FORMAS_PAGAMENTO.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Parcelas</label>
              <Input
                type="number"
                min="1"
                max="24"
                value={venda.parcelas}
                onChange={e =>
                  setVenda(prev => ({ ...prev, parcelas: parseInt(e.target.value) || 1 }))
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Desconto (R$)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={venda.desconto || ''}
                onChange={e => setDesconto(parseFloat(e.target.value) || 0)}
                className={inputClass}
              />
            </div>
            <div className="col-span-2 md:col-span-3 bg-[#0f0f1a] rounded-lg p-3 flex items-center justify-between">
              <span className="text-gray-400 text-sm">Valor Final a Pagar</span>
              <span className="text-xl font-bold text-green-400">{fmt(venda.valor_final)}</span>
            </div>
          </div>
        )}
      </div>

      {/* 6. Observações */}
      <div className={sectionClass}>
        <SectionHeader
          title="6. Observações"
          open={openSections.obs}
          onToggle={() => toggleSection('obs')}
        />
        {openSections.obs && (
          <textarea
            value={venda.observacoes}
            onChange={e => setVenda(prev => ({ ...prev, observacoes: e.target.value }))}
            placeholder="Observações internas sobre esta venda..."
            rows={4}
            className="w-full bg-[#0f0f1a] border border-[#2a2a4e] text-white rounded-md px-3 py-2 text-sm placeholder:text-gray-500 resize-none focus:outline-none focus:border-[#d4a853]"
          />
        )}
      </div>

      {/* Bottom Save */}
      <div className="flex justify-end gap-3 mt-2">
        <Button
          variant="ghost"
          onClick={() => router.push('/vendas')}
          className="text-gray-400 hover:text-white"
        >
          Cancelar
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#d4a853] hover:bg-[#c4953f] text-[#1a1a2e] font-semibold"
        >
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Salvando...' : 'Salvar Venda'}
        </Button>
      </div>

      {/* Flight Search Modal */}
      <FlightSearchModal
        open={flightModalIdx !== null}
        onClose={() => setFlightModalIdx(null)}
        onSelect={(offer: FlightOffer) => {
          if (flightModalIdx === null) return;
          const mapped = formatFlightForVenda(offer);
          updateProduto(flightModalIdx, 'cia_aerea', mapped.cia_aerea);
          updateProduto(flightModalIdx, 'trecho', mapped.trecho);
          updateProduto(flightModalIdx, 'descricao', mapped.descricao);
        }}
      />

      {/* Hotel Search Modal */}
      <HotelSearchModal
        open={hotelModalIdx !== null}
        onClose={() => setHotelModalIdx(null)}
        onSelect={(place: GooglePlace) => {
          if (hotelModalIdx === null) return;
          const mapped = formatHotelForVenda(place);
          updateProduto(hotelModalIdx, 'hotel_nome', mapped.hotel_nome);
          updateProduto(hotelModalIdx, 'descricao', mapped.descricao);
        }}
      />
    </div>
  );
}
