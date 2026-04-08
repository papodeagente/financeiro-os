'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Trash2, ChevronDown, ChevronUp, ArrowLeft, Save, Search, Plane, Hotel, FileText, X, Check } from 'lucide-react';
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
  Proposta,
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
import { toast } from '@/lib/toast';

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
  'bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-secondary)] focus:border-[var(--t-accent)]';
const labelClass = 'block text-sm text-[var(--t-text-secondary)] mb-1';
const sectionClass = 'bg-[var(--t-header-bg)] shadow-[var(--t-card-shadow)] rounded-lg p-5 mb-4';

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
      <h2 className="text-base font-semibold text-[var(--t-text)]">{title}</h2>
      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
        {extra}
        <button
          type="button"
          onClick={onToggle}
          className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export default function NovaVendaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [grupos, setGrupos] = useState<GrupoViagem[]>([]);
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [clienteSearch, setClienteSearch] = useState('');
  const [showClienteList, setShowClienteList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPropostaModal, setShowPropostaModal] = useState(false);
  const [propostaSearch, setPropostaSearch] = useState('');

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
    loadEntities<Proposta>('propostas').then(setPropostas);
    loadGrupos().then(gs => {
      setGrupos(gs);
      // Pre-fill from grupo_id query param
      const grupoId = searchParams.get('grupo_id');
      if (grupoId) {
        const grupo = gs.find(g => g.id === grupoId);
        if (grupo) {
          try {
            const produto = getProdutoGrupo(grupo);
            const custoEntries = Object.values(produto.custos_por_apto) as Array<Record<string, number>>;
            const custoSgl = custoEntries.reduce((sum, entry) => sum + (entry.sgl || 0), 0);
            const vendaSgl = produto.precos.avista.sgl || 0;
            setVenda(prev => ({
              ...prev,
              tipo: 'GRUPO',
              grupo_id: grupo.id,
              observacoes: `Importado do produto ${grupo.grp_id} — ${grupo.origem_destino}`,
              produtos: [{
                ...createProdutoVenda(),
                tipo: 'GRUPO',
                descricao: `Grupo: ${grupo.grp_id || 'Sem ID'} — ${grupo.origem_destino || ''}`,
                fornecedor_nome: 'Operacao Propria',
                valor_custo: custoSgl,
                valor_venda: vendaSgl,
                moeda: 'BRL',
                cambio: 1,
                projeto: grupo.id,
              }],
            }));
          } catch {
            setVenda(prev => ({
              ...prev,
              tipo: 'GRUPO',
              grupo_id: grupo.id,
              observacoes: `Importado do produto ${grupo.grp_id}`,
            }));
          }
        }
      }
    });
  }, [searchParams]);

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

  // ---- Import from Proposta ----
  const importFromProposta = (proposta: Proposta) => {
    const produtos: ProdutoVenda[] = [];

    // Map SERVICO sections → produtos
    for (const s of proposta.secoes.filter(s => s.tipo === 'SERVICO' && s.visivel)) {
      const c = s.conteudo as { titulo?: string; descricao?: string; valor?: number; detalhes?: string[] };
      if (!c.titulo) continue;
      const tipo = guessProductType(c.titulo);
      produtos.push({
        ...createProdutoVenda(),
        tipo,
        descricao: [c.titulo, c.descricao].filter(Boolean).join(' — '),
        valor_venda: c.valor || 0,
      });
    }

    // Map TRANSPORTE (from viagem) → AEREO or transport products
    if (proposta.viagem?.transportes) {
      for (const t of proposta.viagem.transportes) {
        const isVoo = t.tipo === 'VOO';
        const priceMatch = t.detalhes?.match(/R\$\s*([\d.,]+)/);
        const price = priceMatch ? parseFloat(priceMatch[1].replace('.', '').replace(',', '.')) : 0;
        produtos.push({
          ...createProdutoVenda(),
          tipo: isVoo ? 'AEREO' : 'CARRO',
          descricao: `${t.origem} → ${t.destino}${t.companhia ? ` (${t.companhia})` : ''}${t.numero_voo ? ` ${t.numero_voo}` : ''}`,
          cia_aerea: isVoo ? (t.companhia || '') : '',
          trecho: `${t.origem}-${t.destino}`,
          data_inicio: t.data || '',
          fornecedor_nome: t.companhia || '',
          valor_venda: price,
        });
      }
    }

    // Map ALOJAMENTO (from viagem) → HOTEL products
    if (proposta.viagem?.alojamentos) {
      for (const a of proposta.viagem.alojamentos) {
        if (a.viagem_noturna) continue;
        produtos.push({
          ...createProdutoVenda(),
          tipo: 'HOTEL',
          descricao: `${a.hotel_nome} — ${a.destino_nome} (${a.noites}N)`,
          hotel_nome: a.hotel_nome || '',
          tipo_apto: a.quarto_tipo || '',
          regime: a.regime || '',
          data_inicio: a.check_in || '',
          data_fim: a.check_out || '',
          fornecedor_nome: a.hotel_nome || '',
        });
      }
    }

    // Map TRANSPORTE sections (block-level, for CLASSICO layout)
    for (const s of proposta.secoes.filter(s => s.tipo === 'TRANSPORTE' && s.visivel)) {
      const c = s.conteudo as { tipo?: string; origem?: string; destino?: string; companhia?: string; numero_voo?: string; data?: string; detalhes?: string };
      if (!c.origem) continue;
      // Skip if already imported from viagem.transportes
      if (produtos.some(p => p.trecho === `${c.origem}-${c.destino}`)) continue;
      const isVoo = c.tipo === 'VOO';
      produtos.push({
        ...createProdutoVenda(),
        tipo: isVoo ? 'AEREO' : 'CARRO',
        descricao: `${c.origem} → ${c.destino}${c.companhia ? ` (${c.companhia})` : ''}`,
        cia_aerea: isVoo ? (c.companhia || '') : '',
        trecho: `${c.origem}-${c.destino}`,
        data_inicio: c.data || '',
        fornecedor_nome: c.companhia || '',
      });
    }

    // Map ALOJAMENTO sections (block-level)
    for (const s of proposta.secoes.filter(s => s.tipo === 'ALOJAMENTO' && s.visivel)) {
      const c = s.conteudo as { hotel_nome?: string; destino_nome?: string; noites?: number; quarto_tipo?: string; regime?: string; check_in?: string; check_out?: string; viagem_noturna?: boolean };
      if (c.viagem_noturna || !c.hotel_nome) continue;
      // Skip if already imported from viagem.alojamentos
      if (produtos.some(p => p.hotel_nome === c.hotel_nome)) continue;
      produtos.push({
        ...createProdutoVenda(),
        tipo: 'HOTEL',
        descricao: `${c.hotel_nome} — ${c.destino_nome || ''} (${c.noites || 0}N)`,
        hotel_nome: c.hotel_nome || '',
        tipo_apto: c.quarto_tipo || '',
        regime: c.regime || '',
        data_inicio: c.check_in || '',
        data_fim: c.check_out || '',
        fornecedor_nome: c.hotel_nome || '',
      });
    }

    // Extract pricing from VALORES sections if available
    const valoresSecao = proposta.secoes.find(s => s.tipo === 'VALORES' && s.visivel);
    if (valoresSecao) {
      const vc = valoresSecao.conteudo as { opcoes?: Array<{ titulo: string; valor_total: number; destaque?: boolean }> };
      const destaque = vc.opcoes?.find(o => o.destaque) || vc.opcoes?.[0];
      if (destaque && destaque.valor_total > 0 && produtos.length > 0) {
        // If no individual prices set, distribute total across products proportionally
        const hasAnyPrice = produtos.some(p => p.valor_venda > 0);
        if (!hasAnyPrice) {
          // Add as a PACOTE product
          produtos.unshift({
            ...createProdutoVenda(),
            tipo: 'PACOTE',
            descricao: `Pacote: ${destaque.titulo || proposta.cabecalho.titulo}`,
            valor_venda: destaque.valor_total,
          });
        }
      }
    }

    // Apply to venda
    setVenda(prev => {
      const updated = {
        ...prev,
        produtos: [...prev.produtos, ...produtos],
        observacoes: prev.observacoes
          ? `${prev.observacoes}\nImportado da proposta: ${proposta.cabecalho.titulo} (${proposta.numero})`
          : `Importado da proposta: ${proposta.cabecalho.titulo} (${proposta.numero})`,
      };
      // Pre-fill client if not set
      if (!prev.cliente_id && proposta.cliente_id) {
        updated.cliente_id = proposta.cliente_id;
        const c = clientes.find(cl => cl.id === proposta.cliente_id);
        if (c) {
          const nome = c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social;
          setClienteSearch(nome);
        }
      }
      return recalcTotais(updated);
    });

    setShowPropostaModal(false);
  };

  function guessProductType(titulo: string): ProdutoVenda['tipo'] {
    const t = titulo.toLowerCase();
    if (/voo|a[eé]reo|flight|passagem/i.test(t)) return 'AEREO';
    if (/hotel|hospedagem|resort|pousada/i.test(t)) return 'HOTEL';
    if (/seguro|insurance|travel protect/i.test(t)) return 'SEGURO';
    if (/transfer|carro|rent|locacao|aluguel/i.test(t)) return 'CARRO';
    if (/cruzeiro|cruise|navio/i.test(t)) return 'CRUZEIRO';
    if (/ingresso|ticket|entrada|passeio/i.test(t)) return 'INGRESSO';
    if (/receptivo|guia|tour|excurs/i.test(t)) return 'RECEPTIVO';
    if (/pacote|package/i.test(t)) return 'PACOTE';
    return 'OUTROS';
  }

  // ---- Save ----
  const handleSave = async () => {
    if (!venda.cliente_id) {
      toast.error('Selecione um cliente');
      return;
    }
    setSaving(true);
    try {
      await saveEntity('vendas-crm', venda);
      router.push('/vendas');
    } catch {
      toast.error('Erro ao salvar venda');
      setSaving(false);
    }
  };

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/vendas')}
            className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Nova Venda</h1>
            <p className="text-[var(--t-text-secondary)] text-sm font-mono">{venda.numero}</p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-[var(--t-green)] hover:opacity-90 text-white dark:text-[#0a0a14] font-semibold"
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
                <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-[var(--t-header-bg)] shadow-[var(--t-card-shadow)] rounded-md shadow-xl max-h-48 overflow-y-auto">
                  {filteredClientes.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-[var(--t-text-secondary)]">Nenhum cliente encontrado</p>
                  ) : (
                    filteredClientes.map(c => {
                      const nome =
                        c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--t-surface-hover)] text-[var(--t-text)]"
                          onMouseDown={() => selectCliente(c)}
                        >
                          <span className="font-medium">{nome}</span>
                          {c.email && (
                            <span className="text-[var(--t-text-secondary)] ml-2 text-xs">{c.email}</span>
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
                className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] rounded-md px-3 py-2 text-sm"
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
              className="text-[var(--t-green)] hover:bg-[var(--t-green)]/10 border border-[var(--t-green)]/30 h-7 text-xs font-medium"
              onClick={addPassageiro}
            >
              <Plus className="w-3 h-3 mr-1" /> Adicionar
            </Button>
          }
        />
        {openSections.passageiros && (
          <div className="space-y-3">
            {venda.passageiros.length === 0 && (
              <p className="text-[var(--t-text-secondary)] text-sm text-center py-4">
                Nenhum passageiro adicionado
              </p>
            )}
            {venda.passageiros.map((p, idx) => (
              <div
                key={idx}
                className="bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <Badge className="bg-[var(--t-green)]/10 text-[var(--t-green)] border-[var(--t-green)]/30 text-xs font-medium">
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
                      className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] rounded-md px-3 py-2 text-sm"
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
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-blue-400 hover:bg-blue-500/10 border border-blue-500/30 h-7 text-xs font-medium"
                onClick={() => setShowPropostaModal(true)}
              >
                <FileText className="w-3 h-3 mr-1" /> Importar de Proposta
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-[var(--t-green)] hover:bg-[var(--t-green)]/10 border border-[var(--t-green)]/30 h-7 text-xs font-medium"
                onClick={addProduto}
              >
                <Plus className="w-3 h-3 mr-1" /> Adicionar
              </Button>
            </div>
          }
        />
        {openSections.produtos && (
          <div className="space-y-4">
            {venda.produtos.length === 0 && (
              <p className="text-[var(--t-text-secondary)] text-sm text-center py-4">
                Nenhum produto adicionado
              </p>
            )}
            {venda.produtos.map((prod, idx) => (
              <div
                key={prod.id}
                className="bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-xs font-medium">
                      Produto {idx + 1}
                    </Badge>
                    <Badge className="bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] border-[#3a3a5e] text-xs">
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
                      className="w-full bg-[var(--t-header-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] rounded-md px-3 py-2 text-sm"
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
                  <div className="mb-3 pt-3 border-t border-[var(--t-border)]">
                    <label className={labelClass}>Selecionar Produto</label>
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
                  <div className="mb-3 pt-3 border-t border-[var(--t-border)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-[var(--t-text-secondary)]">Dados do voo</span>
                      <button
                        onClick={() => setFlightModalIdx(idx)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-500/10 text-blue-400 text-xs font-medium rounded-lg border border-blue-500/30 hover:bg-blue-500/20 transition-colors"
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
                  <div className="mb-3 pt-3 border-t border-[var(--t-border)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-[var(--t-text-secondary)]">Dados do hotel</span>
                      <button
                        onClick={() => setHotelModalIdx(idx)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-lg border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-[var(--t-border)]">
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
                      className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] rounded-md px-3 py-2 text-sm"
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
                  <div className="mt-2 text-xs text-[var(--t-text-secondary)]">
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
            <div className="bg-[var(--t-bg)] rounded-lg p-3 text-center">
              <p className="text-xs text-[var(--t-text-secondary)] mb-1">Custo Total</p>
              <p className="text-lg font-bold text-orange-400">
                {fmt(venda.valor_total_custo)}
              </p>
            </div>
            <div className="bg-[var(--t-bg)] rounded-lg p-3 text-center">
              <p className="text-xs text-[var(--t-text-secondary)] mb-1">Venda Total</p>
              <p className="text-lg font-bold text-blue-400">
                {fmt(venda.valor_total_venda)}
              </p>
            </div>
            <div className="bg-[var(--t-bg)] rounded-lg p-3 text-center">
              <p className="text-xs text-[var(--t-text-secondary)] mb-1">Markup</p>
              <p className="text-lg font-bold text-[var(--t-accent)]">
                {venda.markup_realizado.toFixed(1)}%
              </p>
            </div>
            <div className="bg-[var(--t-bg)] rounded-lg p-3 text-center">
              <p className="text-xs text-[var(--t-text-secondary)] mb-1">Valor Final</p>
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
                className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] rounded-md px-3 py-2 text-sm"
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
            <div className="col-span-2 md:col-span-3 bg-[var(--t-bg)] rounded-lg p-3 flex items-center justify-between">
              <span className="text-[var(--t-text-secondary)] text-sm">Valor Final a Pagar</span>
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
            className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] rounded-md px-3 py-2 text-sm placeholder:text-[var(--t-text-secondary)] resize-none focus:outline-none focus:border-[var(--t-accent)]"
          />
        )}
      </div>

      {/* Bottom Save */}
      <div className="flex justify-end gap-3 mt-2">
        <Button
          variant="ghost"
          onClick={() => router.push('/vendas')}
          className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)] border border-[var(--t-border)]"
        >
          Cancelar
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-[var(--t-green)] hover:opacity-90 text-white dark:text-[#0a0a14] font-semibold"
        >
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Salvando...' : 'Salvar Venda'}
        </Button>
      </div>

      {/* Flight Search Modal */}
      <FlightSearchModal
        open={flightModalIdx !== null}
        onClose={() => setFlightModalIdx(null)}
        onSelect={(ida: FlightOffer, volta?: FlightOffer) => {
          if (flightModalIdx === null) return;
          const combined: FlightOffer = volta
            ? { ...ida, returnFlights: volta.flights, returnDuration: volta.totalDuration, returnLayovers: volta.layovers }
            : ida;
          const mapped = formatFlightForVenda(combined);
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

      {/* Import from Proposta Modal */}
      {showPropostaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowPropostaModal(false); }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-[var(--t-header-bg)] rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--t-border)]">
              <div>
                <h3 className="text-lg font-bold text-[var(--t-text)]">Importar de Proposta</h3>
                <p className="text-xs text-[var(--t-text-secondary)]">Selecione uma proposta para importar serviços, voos e hospedagens</p>
              </div>
              <button onClick={() => setShowPropostaModal(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="px-5 py-3 border-b border-[var(--t-border)]">
              <Input
                value={propostaSearch}
                onChange={e => setPropostaSearch(e.target.value)}
                placeholder="Buscar por título, cliente ou número..."
                className={inputClass}
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {propostas.length === 0 && (
                <p className="text-center text-[var(--t-text-secondary)] py-8 text-sm">
                  Nenhuma proposta encontrada. Crie propostas antes de importar.
                </p>
              )}
              {propostas
                .filter(p => {
                  if (!propostaSearch) return true;
                  const q = propostaSearch.toLowerCase();
                  return (
                    p.cabecalho.titulo?.toLowerCase().includes(q) ||
                    p.cliente_nome?.toLowerCase().includes(q) ||
                    p.numero?.toLowerCase().includes(q)
                  );
                })
                .map(p => {
                  const secCount = p.secoes.filter(s => s.visivel).length;
                  const transportes = p.viagem?.transportes?.length || 0;
                  const alojamentos = p.viagem?.alojamentos?.length || 0;
                  const servicoCount = p.secoes.filter(s => s.tipo === 'SERVICO' && s.visivel).length;
                  const totalItems = servicoCount + transportes + alojamentos;

                  return (
                    <button
                      key={p.id}
                      onClick={() => importFromProposta(p)}
                      className="w-full text-left p-4 rounded-xl bg-[var(--t-bg)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border)] hover:border-[var(--t-accent)]/50 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-[var(--t-text-secondary)]">{p.numero}</span>
                            {p.visual.layout === 'DISCOVERY' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">DISCOVERY</span>
                            )}
                          </div>
                          <h4 className="font-semibold text-[var(--t-text)] mt-0.5 truncate">
                            {p.cabecalho.titulo || 'Sem título'}
                          </h4>
                          {p.cliente_nome && (
                            <p className="text-xs text-[var(--t-text-secondary)] mt-0.5">{p.cliente_nome}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {servicoCount > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
                                {servicoCount} serviço{servicoCount > 1 ? 's' : ''}
                              </span>
                            )}
                            {transportes > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                                {transportes} transporte{transportes > 1 ? 's' : ''}
                              </span>
                            )}
                            {alojamentos > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                                {alojamentos} hospedagem{alojamentos > 1 ? 'ns' : ''}
                              </span>
                            )}
                            {totalItems === 0 && (
                              <span className="text-[10px] text-[var(--t-text-muted)]">{secCount} blocos</span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="flex items-center gap-1 text-xs text-[var(--t-accent)]">
                            <Check className="w-4 h-4" /> Importar
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
