'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Proposta, SecaoProposta, Cliente, Membro, createProposta } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity } from '@/lib/crm-storage';
import { generateId } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FileText, Save, Send, Eye, ArrowLeft, Plus, Trash2,
  GripVertical, ChevronUp, ChevronDown, Type, Plane,
  Calendar, Image, CheckSquare, DollarSign, Quote, MousePointer,
  MessageCircle, Mail, Copy, Link as LinkIcon, Hotel, Search,
} from 'lucide-react';
import { FlightSearchModal } from '@/components/FlightSearchModal';
import { HotelSearchModal } from '@/components/HotelSearchModal';
import { formatFlightForProposta } from '@/lib/flight-data-mapper';
import { formatHotelForProposta } from '@/lib/hotel-data-mapper';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import type { GooglePlace } from '@/lib/hotel-data-mapper';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const SECAO_TIPOS = [
  { tipo: 'TEXTO', label: 'Texto', icon: Type, desc: 'Bloco de texto livre' },
  { tipo: 'SERVICO', label: 'Servico', icon: Plane, desc: 'Voo, hotel, transfer...' },
  { tipo: 'ROTEIRO_DIA', label: 'Roteiro', icon: Calendar, desc: 'Dia a dia da viagem' },
  { tipo: 'GALERIA', label: 'Galeria', icon: Image, desc: 'Grid de fotos' },
  { tipo: 'INCLUSOS', label: 'Inclusos', icon: CheckSquare, desc: 'O que esta/nao esta incluso' },
  { tipo: 'VALORES', label: 'Valores', icon: DollarSign, desc: 'Tabela de precos' },
  { tipo: 'DEPOIMENTO', label: 'Depoimento', icon: Quote, desc: 'Prova social' },
  { tipo: 'CTA', label: 'CTA', icon: MousePointer, desc: 'Botao de acao' },
] as const;

function defaultConteudo(tipo: string): Record<string, unknown> {
  switch (tipo) {
    case 'TEXTO': return { titulo: '', corpo: '', alinhamento: 'left' };
    case 'SERVICO': return { icone: '✈️', titulo: '', descricao: '', detalhes: [], imagem: '', valor: 0, exibir_valor: true };
    case 'ROTEIRO_DIA': return { dias: [{ numero: 1, titulo: 'Dia 1', descricao: '', imagem: '', atividades: [], refeicoes_inclusas: '' }] };
    case 'GALERIA': return { imagens: [] };
    case 'INCLUSOS': return { inclusos: [''], nao_inclusos: [''] };
    case 'VALORES': return { opcoes: [{ titulo: 'Opcao 1', valor_total: 0, destaque: false, parcelas: [{ forma: 'A vista PIX', valor_parcela: 0, valor_total: 0, destaque: true }] }], observacoes_valores: '', validade: '' };
    case 'DEPOIMENTO': return { depoimentos: [{ texto: '', autor: '', foto: '', destino: '' }] };
    case 'CTA': return { texto_botao: 'Quero reservar minha viagem!', tipo_acao: 'WHATSAPP', numero_whatsapp: '', mensagem_predefinida: '', cor_botao: '#10b981' };
    default: return {};
  }
}

function EditorInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');

  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showAddBloco, setShowAddBloco] = useState(false);
  const [flightModalOpen, setFlightModalOpen] = useState(false);
  const [hotelModalOpen, setHotelModalOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      loadEntities<Cliente>('clientes'),
      loadEntities<Membro>('membros'),
      editId ? fetch(`/api/propostas/${editId}`).then(r => r.json()).catch(() => null) : Promise.resolve(null),
      loadEntities<Proposta>('propostas'),
    ]).then(([cl, mb, existing, all]) => {
      setClientes(cl);
      setMembros(mb);
      if (existing && existing.id) {
        setProposta(existing);
      } else {
        const nextNum = `PROP-${String(all.length + 1).padStart(4, '0')}`;
        setProposta(createProposta(nextNum));
      }
      setLoading(false);
    });
  }, [editId]);

  const update = useCallback((fn: (p: Proposta) => Proposta) => {
    setProposta(prev => prev ? fn({ ...prev }) : prev);
  }, []);

  const handleSave = async () => {
    if (!proposta) return;
    setSaving(true);
    proposta.atualizado_em = new Date().toISOString();
    if (!proposta.link_publico) {
      proposta.link_publico = `${window.location.origin}/p/${proposta.id.slice(0, 8)}`;
    }
    if (editId) {
      await updateEntity('propostas', proposta);
    } else {
      await saveEntity('propostas', proposta);
    }
    setSaving(false);
    router.push('/propostas');
  };

  const addSecao = (tipo: string) => {
    update(p => {
      p.secoes = [...p.secoes, {
        id: generateId(),
        tipo: tipo as SecaoProposta['tipo'],
        ordem: p.secoes.length,
        visivel: true,
        conteudo: defaultConteudo(tipo),
      }];
      return p;
    });
    setShowAddBloco(false);
  };

  const removeSecao = (id: string) => {
    update(p => {
      p.secoes = p.secoes.filter(s => s.id !== id);
      return p;
    });
  };

  const moveSecao = (id: string, dir: -1 | 1) => {
    update(p => {
      const idx = p.secoes.findIndex(s => s.id === id);
      if (idx < 0) return p;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= p.secoes.length) return p;
      const arr = [...p.secoes];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      p.secoes = arr;
      return p;
    });
  };

  const updateSecao = (id: string, conteudo: Record<string, unknown>) => {
    update(p => {
      p.secoes = p.secoes.map(s => s.id === id ? { ...s, conteudo } : s);
      return p;
    });
  };

  const handleEnviarWhatsApp = () => {
    if (!proposta) return;
    const cliente = clientes.find(c => c.id === proposta.cliente_id);
    const phone = cliente?.whatsapp || cliente?.telefone_principal || '';
    const nome = proposta.cliente_nome || cliente?.nome_completo || 'Cliente';
    const msg = encodeURIComponent(
      `Ola, ${nome.split(' ')[0]}! Preparei a proposta da sua viagem. Da uma olhada:\n${proposta.link_publico}\n\nQualquer duvida, e so chamar!\n${proposta.rodape.nome_vendedor}`
    );
    window.open(`https://wa.me/55${phone.replace(/\D/g, '')}?text=${msg}`, '_blank');
  };

  if (loading || !proposta) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--t-green)]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="px-6 py-3 flex items-center justify-between border-b border-[var(--t-border)] bg-[var(--t-bg-secondary)] shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/propostas')} className="text-[var(--t-text-secondary)]">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium text-[var(--t-text)]">
            {editId ? `Editar ${proposta.numero}` : 'Nova Proposta'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {proposta.link_publico && (
            <Button variant="outline" size="sm" className="gap-1 text-xs border-[var(--t-border)] text-[var(--t-text-secondary)]"
              onClick={() => navigator.clipboard.writeText(proposta.link_publico)}>
              <Copy className="w-3 h-3" /> Copiar link
            </Button>
          )}
          {proposta.cliente_id && (
            <Button variant="outline" size="sm" className="gap-1 text-xs border-[var(--t-border)] text-emerald-400"
              onClick={handleEnviarWhatsApp}>
              <MessageCircle className="w-3 h-3" /> WhatsApp
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving} className="bg-[var(--t-green)] text-white dark:text-[#0a0a14] gap-1 text-sm">
            <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[900px] mx-auto p-6 space-y-6">

          {/* Cabecalho */}
          <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
            <CardContent className="p-5 space-y-4">
              <h3 className="text-sm font-medium text-[var(--t-text)]">Cabecalho da Proposta</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Cliente</label>
                  <select
                    value={proposta.cliente_id}
                    onChange={(e) => {
                      const c = clientes.find(cl => cl.id === e.target.value);
                      update(p => {
                        p.cliente_id = e.target.value;
                        p.cliente_nome = c ? (c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social) : '';
                        if (c && !p.cabecalho.subtitulo) p.cabecalho.subtitulo = `Preparada especialmente para ${p.cliente_nome}`;
                        return p;
                      });
                    }}
                    className="w-full mt-1 bg-[var(--t-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Selecionar cliente</option>
                    {clientes.filter(c => c.status === 'ATIVO').map(c => (
                      <option key={c.id} value={c.id}>
                        {c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Vendedor</label>
                  <select
                    value={proposta.vendedor_id}
                    onChange={(e) => {
                      const m = membros.find(mb => mb.id === e.target.value);
                      update(p => {
                        p.vendedor_id = e.target.value;
                        p.vendedor_nome = m?.nome || '';
                        p.rodape.nome_vendedor = m?.nome || '';
                        p.rodape.telefone_vendedor = m?.telefone || '';
                        p.rodape.email_vendedor = m?.email || '';
                        return p;
                      });
                    }}
                    className="w-full mt-1 bg-[var(--t-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Selecionar vendedor</option>
                    {membros.filter(m => m.status === 'ATIVO').map(m => (
                      <option key={m.id} value={m.id}>{m.nome}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--t-text-secondary)]">Titulo</label>
                <Input
                  value={proposta.cabecalho.titulo}
                  onChange={(e) => update(p => { p.cabecalho.titulo = e.target.value; return p; })}
                  placeholder="Ex: Proposta de Viagem — Europa 2026"
                  className="mt-1 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--t-text-secondary)]">Subtitulo</label>
                <Input
                  value={proposta.cabecalho.subtitulo}
                  onChange={(e) => update(p => { p.cabecalho.subtitulo = e.target.value; return p; })}
                  placeholder="Ex: Preparada especialmente para Maria Silva"
                  className="mt-1 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--t-text-secondary)]">Mensagem de abertura</label>
                <textarea
                  value={proposta.cabecalho.mensagem_abertura}
                  onChange={(e) => update(p => { p.cabecalho.mensagem_abertura = e.target.value; return p; })}
                  rows={3}
                  placeholder="Ola! Preparei esta proposta com todo carinho para a sua viagem dos sonhos..."
                  className="w-full mt-1 bg-[var(--t-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Data da proposta</label>
                  <Input
                    type="date"
                    value={proposta.cabecalho.data_proposta}
                    onChange={(e) => update(p => { p.cabecalho.data_proposta = e.target.value; return p; })}
                    className="mt-1 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Validade</label>
                  <Input
                    type="date"
                    value={proposta.cabecalho.validade}
                    onChange={(e) => update(p => { p.cabecalho.validade = e.target.value; return p; })}
                    className="mt-1 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Secoes */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--t-text)]">Blocos da Proposta ({proposta.secoes.length})</h3>
            </div>

            {proposta.secoes.map((secao, idx) => {
              const tipoInfo = SECAO_TIPOS.find(t => t.tipo === secao.tipo);
              const TipoIcon = tipoInfo?.icon || Type;

              return (
                <Card key={secao.id} className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
                  <CardContent className="p-4">
                    {/* Secao header */}
                    <div className="flex items-center gap-2 mb-3">
                      <GripVertical className="w-4 h-4 text-[var(--t-text-muted)] cursor-grab" />
                      <TipoIcon className="w-4 h-4 text-[var(--t-green)]" />
                      <span className="text-xs font-medium text-[var(--t-text)] flex-1">{tipoInfo?.label || secao.tipo}</span>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[var(--t-text-secondary)]"
                        onClick={() => moveSecao(secao.id, -1)} disabled={idx === 0}>
                        <ChevronUp className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[var(--t-text-secondary)]"
                        onClick={() => moveSecao(secao.id, 1)} disabled={idx === proposta.secoes.length - 1}>
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400" onClick={() => removeSecao(secao.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Content editors per type */}
                    {secao.tipo === 'TEXTO' && (
                      <div className="space-y-2">
                        <Input
                          value={(secao.conteudo as { titulo?: string }).titulo || ''}
                          onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, titulo: e.target.value })}
                          placeholder="Titulo do bloco"
                          className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                        />
                        <textarea
                          value={(secao.conteudo as { corpo?: string }).corpo || ''}
                          onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, corpo: e.target.value })}
                          rows={3} placeholder="Texto..."
                          className="w-full bg-[var(--t-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none"
                        />
                      </div>
                    )}

                    {secao.tipo === 'SERVICO' && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-6 gap-2">
                          <Input
                            value={(secao.conteudo as { icone?: string }).icone || ''}
                            onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, icone: e.target.value })}
                            placeholder="Icone"
                            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] col-span-1"
                          />
                          <Input
                            value={(secao.conteudo as { titulo?: string }).titulo || ''}
                            onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, titulo: e.target.value })}
                            placeholder="Ex: Voo Sao Paulo → Lisboa"
                            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] col-span-5"
                          />
                        </div>
                        <textarea
                          value={(secao.conteudo as { descricao?: string }).descricao || ''}
                          onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, descricao: e.target.value })}
                          rows={2} placeholder="Descricao do servico..."
                          className="w-full bg-[var(--t-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="number"
                            value={(secao.conteudo as { valor?: number }).valor || ''}
                            onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, valor: Number(e.target.value) })}
                            placeholder="Valor (R$)"
                            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                          />
                          <Input
                            value={(secao.conteudo as { imagem?: string }).imagem || ''}
                            onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, imagem: e.target.value })}
                            placeholder="URL da imagem (opcional)"
                            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                          />
                        </div>
                      </div>
                    )}

                    {secao.tipo === 'INCLUSOS' && (() => {
                      const cont = secao.conteudo as { inclusos?: string[]; nao_inclusos?: string[] };
                      const inclusos = cont.inclusos || [''];
                      const naoInclusos = cont.nao_inclusos || [''];
                      return (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-xs text-emerald-400 font-medium">Incluso</span>
                            {inclusos.map((item, i) => (
                              <div key={i} className="flex gap-1 mt-1">
                                <Input
                                  value={item}
                                  onChange={(e) => {
                                    const arr = [...inclusos]; arr[i] = e.target.value;
                                    updateSecao(secao.id, { ...secao.conteudo, inclusos: arr });
                                  }}
                                  placeholder="Item incluso..."
                                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
                                />
                                {inclusos.length > 1 && (
                                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-red-400 shrink-0"
                                    onClick={() => updateSecao(secao.id, { ...secao.conteudo, inclusos: inclusos.filter((_, j) => j !== i) })}>
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                )}
                              </div>
                            ))}
                            <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)] mt-1"
                              onClick={() => updateSecao(secao.id, { ...secao.conteudo, inclusos: [...inclusos, ''] })}>
                              <Plus className="w-3 h-3 mr-1" /> Adicionar
                            </Button>
                          </div>
                          <div>
                            <span className="text-xs text-red-400 font-medium">Nao incluso</span>
                            {naoInclusos.map((item, i) => (
                              <div key={i} className="flex gap-1 mt-1">
                                <Input
                                  value={item}
                                  onChange={(e) => {
                                    const arr = [...naoInclusos]; arr[i] = e.target.value;
                                    updateSecao(secao.id, { ...secao.conteudo, nao_inclusos: arr });
                                  }}
                                  placeholder="Item nao incluso..."
                                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
                                />
                                {naoInclusos.length > 1 && (
                                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-red-400 shrink-0"
                                    onClick={() => updateSecao(secao.id, { ...secao.conteudo, nao_inclusos: naoInclusos.filter((_, j) => j !== i) })}>
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                )}
                              </div>
                            ))}
                            <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)] mt-1"
                              onClick={() => updateSecao(secao.id, { ...secao.conteudo, nao_inclusos: [...naoInclusos, ''] })}>
                              <Plus className="w-3 h-3 mr-1" /> Adicionar
                            </Button>
                          </div>
                        </div>
                      );
                    })()}

                    {secao.tipo === 'VALORES' && (() => {
                      const cont = secao.conteudo as { opcoes?: Array<{ titulo: string; valor_total: number; destaque: boolean; parcelas: Array<{ forma: string; valor_parcela: number; valor_total: number; destaque: boolean }> }>; observacoes_valores?: string; validade?: string };
                      const opcoes = cont.opcoes || [];
                      return (
                        <div className="space-y-3">
                          {opcoes.map((opc, i) => (
                            <div key={i} className="p-3 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)] space-y-2">
                              <div className="grid grid-cols-3 gap-2">
                                <Input
                                  value={opc.titulo}
                                  onChange={(e) => {
                                    const arr = [...opcoes]; arr[i] = { ...arr[i], titulo: e.target.value };
                                    updateSecao(secao.id, { ...secao.conteudo, opcoes: arr });
                                  }}
                                  placeholder="Ex: SGL, DBL..."
                                  className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)]"
                                />
                                <Input
                                  type="number"
                                  value={opc.valor_total || ''}
                                  onChange={(e) => {
                                    const arr = [...opcoes]; arr[i] = { ...arr[i], valor_total: Number(e.target.value) };
                                    updateSecao(secao.id, { ...secao.conteudo, opcoes: arr });
                                  }}
                                  placeholder="Valor total"
                                  className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)]"
                                />
                                <Button variant="ghost" size="sm" className="text-red-400"
                                  onClick={() => updateSecao(secao.id, { ...secao.conteudo, opcoes: opcoes.filter((_, j) => j !== i) })}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                              {opc.parcelas?.map((parc, pi) => (
                                <div key={pi} className="grid grid-cols-3 gap-2 ml-4">
                                  <Input value={parc.forma} onChange={(e) => {
                                    const arr = [...opcoes]; const parcs = [...arr[i].parcelas]; parcs[pi] = { ...parcs[pi], forma: e.target.value };
                                    arr[i] = { ...arr[i], parcelas: parcs }; updateSecao(secao.id, { ...secao.conteudo, opcoes: arr });
                                  }} placeholder="Forma (10x Cartao, PIX...)" className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)] text-xs" />
                                  <Input type="number" value={parc.valor_parcela || ''} onChange={(e) => {
                                    const arr = [...opcoes]; const parcs = [...arr[i].parcelas]; parcs[pi] = { ...parcs[pi], valor_parcela: Number(e.target.value) };
                                    arr[i] = { ...arr[i], parcelas: parcs }; updateSecao(secao.id, { ...secao.conteudo, opcoes: arr });
                                  }} placeholder="Valor parcela" className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)] text-xs" />
                                  <Button variant="ghost" size="sm" className="text-red-400 h-9"
                                    onClick={() => {
                                      const arr = [...opcoes]; arr[i] = { ...arr[i], parcelas: arr[i].parcelas.filter((_, j) => j !== pi) };
                                      updateSecao(secao.id, { ...secao.conteudo, opcoes: arr });
                                    }}>
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              ))}
                              <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)] ml-4"
                                onClick={() => {
                                  const arr = [...opcoes]; arr[i] = { ...arr[i], parcelas: [...(arr[i].parcelas || []), { forma: '', valor_parcela: 0, valor_total: 0, destaque: false }] };
                                  updateSecao(secao.id, { ...secao.conteudo, opcoes: arr });
                                }}>
                                <Plus className="w-3 h-3 mr-1" /> Forma de pagamento
                              </Button>
                            </div>
                          ))}
                          <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)]"
                            onClick={() => updateSecao(secao.id, { ...secao.conteudo, opcoes: [...opcoes, { titulo: '', valor_total: 0, destaque: false, parcelas: [] }] })}>
                            <Plus className="w-3 h-3 mr-1" /> Opcao de valor
                          </Button>
                          <Input
                            value={cont.observacoes_valores || ''}
                            onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, observacoes_valores: e.target.value })}
                            placeholder="Observacoes (Ex: Criancas ate 2 anos gratis)"
                            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                          />
                        </div>
                      );
                    })()}

                    {secao.tipo === 'CTA' && (
                      <div className="space-y-2">
                        <Input
                          value={(secao.conteudo as { texto_botao?: string }).texto_botao || ''}
                          onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, texto_botao: e.target.value })}
                          placeholder="Texto do botao"
                          className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                        />
                        <Input
                          value={(secao.conteudo as { numero_whatsapp?: string }).numero_whatsapp || ''}
                          onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, numero_whatsapp: e.target.value })}
                          placeholder="Numero WhatsApp"
                          className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                        />
                        <Input
                          value={(secao.conteudo as { mensagem_predefinida?: string }).mensagem_predefinida || ''}
                          onChange={(e) => updateSecao(secao.id, { ...secao.conteudo, mensagem_predefinida: e.target.value })}
                          placeholder="Mensagem predefinida"
                          className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                        />
                      </div>
                    )}

                    {secao.tipo === 'DEPOIMENTO' && (() => {
                      const cont = secao.conteudo as { depoimentos?: Array<{ texto: string; autor: string; destino: string }> };
                      const deps = cont.depoimentos || [];
                      return (
                        <div className="space-y-2">
                          {deps.map((d, i) => (
                            <div key={i} className="flex gap-2">
                              <div className="flex-1 space-y-1">
                                <textarea value={d.texto} onChange={(e) => {
                                  const arr = [...deps]; arr[i] = { ...arr[i], texto: e.target.value };
                                  updateSecao(secao.id, { ...secao.conteudo, depoimentos: arr });
                                }} rows={2} placeholder="Depoimento..." className="w-full bg-[var(--t-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none" />
                                <div className="grid grid-cols-2 gap-1">
                                  <Input value={d.autor} onChange={(e) => {
                                    const arr = [...deps]; arr[i] = { ...arr[i], autor: e.target.value };
                                    updateSecao(secao.id, { ...secao.conteudo, depoimentos: arr });
                                  }} placeholder="Autor" className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs" />
                                  <Input value={d.destino} onChange={(e) => {
                                    const arr = [...deps]; arr[i] = { ...arr[i], destino: e.target.value };
                                    updateSecao(secao.id, { ...secao.conteudo, depoimentos: arr });
                                  }} placeholder="Viajou para..." className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs" />
                                </div>
                              </div>
                              <Button variant="ghost" size="sm" className="text-red-400 shrink-0 self-start"
                                onClick={() => updateSecao(secao.id, { ...secao.conteudo, depoimentos: deps.filter((_, j) => j !== i) })}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                          <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)]"
                            onClick={() => updateSecao(secao.id, { ...secao.conteudo, depoimentos: [...deps, { texto: '', autor: '', destino: '' }] })}>
                            <Plus className="w-3 h-3 mr-1" /> Depoimento
                          </Button>
                        </div>
                      );
                    })()}

                    {secao.tipo === 'ROTEIRO_DIA' && (() => {
                      const cont = secao.conteudo as { dias?: Array<{ numero: number; titulo: string; descricao: string; atividades: string[] }> };
                      const dias = cont.dias || [];
                      return (
                        <div className="space-y-2">
                          {dias.map((dia, i) => (
                            <div key={i} className="p-3 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)] space-y-2">
                              <div className="flex gap-2">
                                <Input value={dia.titulo} onChange={(e) => {
                                  const arr = [...dias]; arr[i] = { ...arr[i], titulo: e.target.value };
                                  updateSecao(secao.id, { ...secao.conteudo, dias: arr });
                                }} placeholder={`Dia ${dia.numero}`} className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] text-[var(--t-text)] flex-1" />
                                <Button variant="ghost" size="sm" className="text-red-400 shrink-0"
                                  onClick={() => updateSecao(secao.id, { ...secao.conteudo, dias: dias.filter((_, j) => j !== i) })}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                              <textarea value={dia.descricao} onChange={(e) => {
                                const arr = [...dias]; arr[i] = { ...arr[i], descricao: e.target.value };
                                updateSecao(secao.id, { ...secao.conteudo, dias: arr });
                              }} rows={2} placeholder="Descricao do dia..." className="w-full bg-[var(--t-bg-secondary)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none" />
                            </div>
                          ))}
                          <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)]"
                            onClick={() => updateSecao(secao.id, { ...secao.conteudo, dias: [...dias, { numero: dias.length + 1, titulo: `Dia ${dias.length + 1}`, descricao: '', atividades: [] }] })}>
                            <Plus className="w-3 h-3 mr-1" /> Dia
                          </Button>
                        </div>
                      );
                    })()}

                    {secao.tipo === 'GALERIA' && (() => {
                      const cont = secao.conteudo as { imagens?: Array<{ url: string; legenda: string }> };
                      const imgs = cont.imagens || [];
                      return (
                        <div className="space-y-2">
                          {imgs.map((img, i) => (
                            <div key={i} className="grid grid-cols-5 gap-2">
                              <Input value={img.url} onChange={(e) => {
                                const arr = [...imgs]; arr[i] = { ...arr[i], url: e.target.value };
                                updateSecao(secao.id, { ...secao.conteudo, imagens: arr });
                              }} placeholder="URL da imagem" className="col-span-3 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]" />
                              <Input value={img.legenda} onChange={(e) => {
                                const arr = [...imgs]; arr[i] = { ...arr[i], legenda: e.target.value };
                                updateSecao(secao.id, { ...secao.conteudo, imagens: arr });
                              }} placeholder="Legenda" className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]" />
                              <Button variant="ghost" size="sm" className="text-red-400"
                                onClick={() => updateSecao(secao.id, { ...secao.conteudo, imagens: imgs.filter((_, j) => j !== i) })}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                          <Button variant="ghost" size="sm" className="text-xs text-[var(--t-green)]"
                            onClick={() => updateSecao(secao.id, { ...secao.conteudo, imagens: [...imgs, { url: '', legenda: '' }] })}>
                            <Plus className="w-3 h-3 mr-1" /> Imagem
                          </Button>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              );
            })}

            {/* Add block */}
            {showAddBloco ? (
              <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)] border-dashed">
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {SECAO_TIPOS.map(t => {
                      const Icon = t.icon;
                      return (
                        <button
                          key={t.tipo}
                          onClick={() => addSecao(t.tipo)}
                          className="flex items-center gap-2 p-3 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)] hover:border-[var(--t-green)] hover:bg-[var(--t-green)]/5 transition-all text-left"
                        >
                          <Icon className="w-4 h-4 text-[var(--t-green)]" />
                          <div>
                            <div className="text-xs font-medium text-[var(--t-text)]">{t.label}</div>
                            <div className="text-[10px] text-[var(--t-text-muted)]">{t.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--t-border)]">
                    <button
                      onClick={() => { setFlightModalOpen(true); setShowAddBloco(false); }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--t-blue-bg)]0/10 border border-blue-500/20 hover:border-blue-400 text-blue-400 text-xs font-medium transition-all"
                    >
                      <Plane className="w-4 h-4" /> Buscar Voo (API)
                    </button>
                    <button
                      onClick={() => { setHotelModalOpen(true); setShowAddBloco(false); }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 hover:border-emerald-400 text-emerald-400 text-xs font-medium transition-all"
                    >
                      <Hotel className="w-4 h-4" /> Buscar Hotel (API)
                    </button>
                  </div>
                  <Button variant="ghost" size="sm" className="mt-2 text-xs text-[var(--t-text-secondary)]"
                    onClick={() => setShowAddBloco(false)}>
                    Cancelar
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <button
                onClick={() => setShowAddBloco(true)}
                className="w-full py-4 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-secondary)] hover:text-[var(--t-green)] hover:border-[var(--t-green)] transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Adicionar bloco
              </button>
            )}
          </div>

          {/* Rodape */}
          <Card className="bg-[var(--t-bg-secondary)] border-[var(--t-border)]">
            <CardContent className="p-5 space-y-3">
              <h3 className="text-sm font-medium text-[var(--t-text)]">Rodape</h3>
              <textarea
                value={proposta.rodape.mensagem}
                onChange={(e) => update(p => { p.rodape.mensagem = e.target.value; return p; })}
                rows={2} placeholder="Mensagem de encerramento..."
                className="w-full bg-[var(--t-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  value={proposta.rodape.nome_vendedor}
                  onChange={(e) => update(p => { p.rodape.nome_vendedor = e.target.value; return p; })}
                  placeholder="Nome do vendedor"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                />
                <Input
                  value={proposta.rodape.whatsapp_vendedor}
                  onChange={(e) => update(p => { p.rodape.whatsapp_vendedor = e.target.value; return p; })}
                  placeholder="WhatsApp do vendedor"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Flight & Hotel Search Modals */}
      <FlightSearchModal
        open={flightModalOpen}
        onClose={() => setFlightModalOpen(false)}
        onSelect={(offer: FlightOffer) => {
          const conteudo = formatFlightForProposta(offer);
          update(p => {
            p.secoes = [...p.secoes, {
              id: generateId(),
              tipo: 'SERVICO' as SecaoProposta['tipo'],
              ordem: p.secoes.length,
              visivel: true,
              conteudo,
            }];
            return p;
          });
        }}
      />
      <HotelSearchModal
        open={hotelModalOpen}
        onClose={() => setHotelModalOpen(false)}
        onSelect={(place: GooglePlace) => {
          const conteudo = formatHotelForProposta(place);
          update(p => {
            p.secoes = [...p.secoes, {
              id: generateId(),
              tipo: 'SERVICO' as SecaoProposta['tipo'],
              ordem: p.secoes.length,
              visivel: true,
              conteudo,
            }];
            return p;
          });
        }}
      />
    </div>
  );
}

export default function PropostaNovaPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--t-green)]" />
      </div>
    }>
      <EditorInner />
    </Suspense>
  );
}
