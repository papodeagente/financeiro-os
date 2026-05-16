'use client';

import { useState } from 'react';
import { Proposta, Cliente, Membro, Destino, SecaoProposta, type LayoutProposta, type DestinoRoteiro, createCliente } from '@/lib/crm-types';
import { generateId } from '@/lib/utils';
import { saveEntity } from '@/lib/crm-storage';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DestinoAutocomplete } from './DestinoAutocomplete';
import { DestinoQuickFill } from './DestinoQuickFill';
import { ImageUpload } from './ImageUpload';
import { TEMAS } from '@/lib/temas-proposta';
import { IDIOMAS, type IdiomaProposal } from '@/lib/i18n-proposta';
import { UserPlus, X } from 'lucide-react';
import { toast } from '@/lib/toast';

type Tab = 'config' | 'destinos' | 'viagem';

interface Props {
  proposta: Proposta;
  clientes: Cliente[];
  membros: Membro[];
  onUpdate: (fn: (p: Proposta) => Proposta) => void;
  onSetAIDestino?: (destino: Destino) => void;
  onClienteCreated?: (c: Cliente) => void;
  // Quando definido, renderiza botao de fechar no header e o sidebar
  // funciona como drawer abrindo/fechando sob demanda (vs sempre visivel).
  onClose?: () => void;
}

export function PropostaSidebar({ proposta, clientes, membros, onUpdate, onSetAIDestino, onClienteCreated, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('config');
  const [selectedDestino, setSelectedDestino] = useState<Destino | null>(null);
  const [newTag, setNewTag] = useState('');
  const isDiscovery = proposta.visual.layout === 'DISCOVERY';

  // Inline client quick-create
  const [clienteSearch, setClienteSearch] = useState('');
  const [showClienteList, setShowClienteList] = useState(false);
  const [showNovoCliente, setShowNovoCliente] = useState(false);
  const [novoClienteTipo, setNovoClienteTipo] = useState<'PF' | 'PJ'>('PF');
  const [novoClienteNome, setNovoClienteNome] = useState('');
  const [novoClienteEmail, setNovoClienteEmail] = useState('');
  const [novoClienteTelefone, setNovoClienteTelefone] = useState('');
  const [savingCliente, setSavingCliente] = useState(false);

  const filteredClientesSidebar = clientes.filter(c => {
    if (c.status !== 'ATIVO') return false;
    if (!clienteSearch) return true;
    const q = clienteSearch.toLowerCase();
    const nome = c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social;
    return nome.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  const selectClienteSidebar = (c: Cliente) => {
    const nome = c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social;
    onUpdate(p => {
      p.cliente_id = c.id;
      p.cliente_nome = nome;
      if (!p.cabecalho.subtitulo) p.cabecalho.subtitulo = `Preparada especialmente para ${nome}`;
      return p;
    });
    setClienteSearch(nome);
    setShowClienteList(false);
  };

  const handleCriarClienteSidebar = async () => {
    if (!novoClienteNome.trim()) { toast.error('Informe o nome do cliente'); return; }
    setSavingCliente(true);
    try {
      const novo = createCliente();
      novo.tipo = novoClienteTipo;
      if (novoClienteTipo === 'PF') novo.nome_completo = novoClienteNome.trim();
      else novo.nome_fantasia = novoClienteNome.trim();
      novo.email = novoClienteEmail.trim();
      novo.telefone_principal = novoClienteTelefone.trim();
      await saveEntity('clientes', novo);
      if (onClienteCreated) onClienteCreated(novo);
      selectClienteSidebar(novo);
      setShowNovoCliente(false);
      setNovoClienteNome(''); setNovoClienteEmail(''); setNovoClienteTelefone('');
      toast.success('Cliente cadastrado!');
    } catch {
      toast.error('Erro ao cadastrar cliente');
    } finally {
      setSavingCliente(false);
    }
  };

  // Sync search text when proposta.cliente_id changes externally
  const currentCliente = clientes.find(c => c.id === proposta.cliente_id);
  const currentClienteNome = currentCliente
    ? (currentCliente.tipo === 'PF' ? currentCliente.nome_completo : currentCliente.nome_fantasia || currentCliente.razao_social)
    : '';

  const addBlock = (tipo: string, conteudo: Record<string, unknown>) => {
    onUpdate(p => ({
      ...p,
      secoes: [...p.secoes, {
        id: generateId(),
        tipo: tipo as SecaoProposta['tipo'],
        ordem: p.secoes.length,
        visivel: true,
        conteudo,
      }],
    }));
  };

  return (
    <div className="w-80 border-l border-[var(--t-border)] bg-[var(--t-surface)] flex flex-col shrink-0 hidden lg:flex">
      {/* Header com botao de fechar (quando em modo drawer) */}
      {onClose && (
        <div className="px-3 py-2 border-b border-[var(--t-border)] flex items-center justify-between shrink-0">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)]">
            Configuração da página
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]"
            title="Fechar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Tabs */}
      <div className="flex border-b border-[var(--t-border)] shrink-0">
        <button
          onClick={() => setTab('config')}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
            tab === 'config'
              ? 'text-[var(--t-green)] border-b-2 border-[var(--t-green)]'
              : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)]'
          }`}
        >
          Configuracao
        </button>
        <button
          onClick={() => setTab('destinos')}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
            tab === 'destinos'
              ? 'text-[var(--t-green)] border-b-2 border-[var(--t-green)]'
              : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)]'
          }`}
        >
          Destinos
        </button>
        {isDiscovery && (
          <button
            onClick={() => setTab('viagem')}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
              tab === 'viagem'
                ? 'text-[var(--t-green)] border-b-2 border-[var(--t-green)]'
                : 'text-[var(--t-text-muted)] hover:text-[var(--t-text)]'
            }`}
          >
            Viagem
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'viagem' && isDiscovery ? (
          <ViagemTab proposta={proposta} onUpdate={onUpdate} newTag={newTag} setNewTag={setNewTag} />
        ) : tab === 'destinos' ? (
          <div className="p-4 space-y-4">
            <DestinoAutocomplete onSelect={d => setSelectedDestino(d)} />

            {selectedDestino ? (
              <DestinoQuickFill
                destino={selectedDestino}
                onAddTextoBlock={c => addBlock('TEXTO', c)}
                onAddGaleriaBlock={c => addBlock('GALERIA', c)}
                onUseAsAIContext={d => {
                  if (onSetAIDestino) onSetAIDestino(d);
                }}
                onClose={() => setSelectedDestino(null)}
              />
            ) : (
              <div className="text-center py-8">
                <p className="text-xs text-[var(--t-text-muted)]">
                  Busque um destino do banco para auto-preencher blocos da proposta
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-5">
            {/* Cabecalho */}
            <section>
              <h4 className="text-xs font-semibold text-[var(--t-text-muted)] uppercase tracking-wider mb-3">Cabecalho</h4>
              <div className="space-y-3">
                <div className="relative">
                  <label className="text-xs text-[var(--t-text-secondary)]">Cliente</label>
                  <Input
                    value={clienteSearch || currentClienteNome}
                    onChange={e => {
                      setClienteSearch(e.target.value);
                      setShowClienteList(true);
                      setShowNovoCliente(false);
                      if (!e.target.value) onUpdate(p => { p.cliente_id = ''; p.cliente_nome = ''; return p; });
                    }}
                    onFocus={() => { setShowClienteList(true); if (!clienteSearch && currentClienteNome) setClienteSearch(currentClienteNome); }}
                    placeholder="Buscar cliente..."
                    className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
                  />
                  {showClienteList && clienteSearch && !showNovoCliente && (
                    <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-[var(--t-surface)] shadow-xl rounded-lg max-h-48 overflow-y-auto border border-[var(--t-border)]">
                      {filteredClientesSidebar.map(c => {
                        const nome = c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social;
                        return (
                          <button key={c.id} type="button"
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--t-surface-hover)] text-[var(--t-text)]"
                            onMouseDown={() => selectClienteSidebar(c)}>
                            <span className="font-medium">{nome}</span>
                            {c.email && <span className="text-[var(--t-text-secondary)] ml-1.5 text-[10px]">{c.email}</span>}
                          </button>
                        );
                      })}
                      {filteredClientesSidebar.length === 0 && (
                        <p className="px-3 py-1.5 text-[10px] text-[var(--t-text-secondary)]">Nenhum cliente encontrado</p>
                      )}
                      <button type="button"
                        className="w-full text-left px-3 py-1.5 text-xs font-medium text-[var(--t-green)] hover:bg-[var(--t-green-bg)]/30 border-t border-[var(--t-border)] flex items-center gap-1"
                        onMouseDown={() => { setShowNovoCliente(true); setShowClienteList(false); setNovoClienteNome(clienteSearch); }}>
                        <UserPlus className="w-3 h-3" /> Cadastrar novo
                      </button>
                    </div>
                  )}
                  {showNovoCliente && (
                    <div className="mt-2 p-2.5 rounded-lg border border-[var(--t-green)]/30 bg-[var(--t-bg)] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-[var(--t-green)]">Novo cliente</span>
                        <button type="button" onClick={() => setShowNovoCliente(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => setNovoClienteTipo('PF')}
                          className={`flex-1 text-[10px] py-1 rounded border transition-colors ${novoClienteTipo === 'PF' ? 'border-[var(--t-green)] bg-[var(--t-green-bg)]/30 text-[var(--t-green)] font-semibold' : 'border-[var(--t-border)] text-[var(--t-text-secondary)]'}`}>
                          PF
                        </button>
                        <button type="button" onClick={() => setNovoClienteTipo('PJ')}
                          className={`flex-1 text-[10px] py-1 rounded border transition-colors ${novoClienteTipo === 'PJ' ? 'border-[var(--t-green)] bg-[var(--t-green-bg)]/30 text-[var(--t-green)] font-semibold' : 'border-[var(--t-border)] text-[var(--t-text-secondary)]'}`}>
                          PJ
                        </button>
                      </div>
                      <Input value={novoClienteNome} onChange={e => setNovoClienteNome(e.target.value)}
                        placeholder={novoClienteTipo === 'PF' ? 'Nome completo' : 'Nome fantasia'}
                        className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs h-8" />
                      <Input value={novoClienteEmail} onChange={e => setNovoClienteEmail(e.target.value)}
                        placeholder="E-mail" type="email"
                        className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs h-8" />
                      <Input value={novoClienteTelefone} onChange={e => setNovoClienteTelefone(e.target.value)}
                        placeholder="Telefone"
                        className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs h-8" />
                      <Button type="button" onClick={handleCriarClienteSidebar} disabled={savingCliente}
                        className="w-full bg-[var(--t-green)] hover:bg-[var(--t-green)]/90 text-white dark:text-[#0a0a14] text-[10px] h-7">
                        {savingCliente ? 'Salvando...' : 'Cadastrar e selecionar'}
                      </Button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Vendedor</label>
                  <select
                    value={proposta.vendedor_id}
                    onChange={e => {
                      const m = membros.find(mb => mb.id === e.target.value);
                      onUpdate(p => {
                        p.vendedor_id = e.target.value;
                        p.vendedor_nome = m?.nome || '';
                        p.rodape.nome_vendedor = m?.nome || '';
                        p.rodape.telefone_vendedor = m?.telefone || '';
                        p.rodape.email_vendedor = m?.email || '';
                        return p;
                      });
                    }}
                    className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Selecionar vendedor</option>
                    {membros.filter(m => m.status === 'ATIVO').map(m => (
                      <option key={m.id} value={m.id}>{m.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Titulo</label>
                  <Input
                    value={proposta.cabecalho.titulo}
                    onChange={e => onUpdate(p => { p.cabecalho.titulo = e.target.value; return p; })}
                    placeholder="Ex: Proposta de Viagem — Europa 2026"
                    className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Subtitulo</label>
                  <Input
                    value={proposta.cabecalho.subtitulo}
                    onChange={e => onUpdate(p => { p.cabecalho.subtitulo = e.target.value; return p; })}
                    placeholder="Ex: Preparada especialmente para..."
                    className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Mensagem de abertura</label>
                  <textarea
                    value={proposta.cabecalho.mensagem_abertura}
                    onChange={e => onUpdate(p => { p.cabecalho.mensagem_abertura = e.target.value; return p; })}
                    rows={3}
                    placeholder="Ola! Preparei esta proposta com todo carinho..."
                    className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)]">Data</label>
                    <Input
                      type="date"
                      value={proposta.cabecalho.data_proposta}
                      onChange={e => onUpdate(p => { p.cabecalho.data_proposta = e.target.value; return p; })}
                      className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)]">Validade</label>
                    <Input
                      type="date"
                      value={proposta.cabecalho.validade}
                      onChange={e => onUpdate(p => { p.cabecalho.validade = e.target.value; return p; })}
                      className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Idioma da proposta</label>
                  <div className="flex gap-1.5 mt-1.5">
                    {IDIOMAS.map(idioma => (
                      <button
                        key={idioma.id}
                        onClick={() => onUpdate(p => { p.idioma = idioma.id as IdiomaProposal; return p; })}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                          (proposta.idioma || 'pt-BR') === idioma.id
                            ? 'border-[var(--t-green)] bg-[var(--t-green)]/10 text-[var(--t-green)]'
                            : 'border-[var(--t-border)] text-[var(--t-text-muted)] hover:border-[var(--t-text-muted)]'
                        }`}
                      >
                        <span>{idioma.flag}</span>
                        <span>{idioma.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <div className="border-t border-[var(--t-border)]" />

            {/* Rodape */}
            <section>
              <h4 className="text-xs font-semibold text-[var(--t-text-muted)] uppercase tracking-wider mb-3">Rodape</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Mensagem de encerramento</label>
                  <textarea
                    value={proposta.rodape.mensagem}
                    onChange={e => onUpdate(p => { p.rodape.mensagem = e.target.value; return p; })}
                    rows={2}
                    placeholder="Mensagem de encerramento..."
                    className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Nome do vendedor</label>
                  <Input
                    value={proposta.rodape.nome_vendedor}
                    onChange={e => onUpdate(p => { p.rodape.nome_vendedor = e.target.value; return p; })}
                    placeholder="Nome"
                    className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">WhatsApp</label>
                  <Input
                    value={proposta.rodape.whatsapp_vendedor}
                    onChange={e => onUpdate(p => { p.rodape.whatsapp_vendedor = e.target.value; return p; })}
                    placeholder="WhatsApp do vendedor"
                    className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Email</label>
                  <Input
                    value={proposta.rodape.email_vendedor}
                    onChange={e => onUpdate(p => { p.rodape.email_vendedor = e.target.value; return p; })}
                    placeholder="Email"
                    className="mt-1 bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
              </div>
            </section>

            <div className="border-t border-[var(--t-border)]" />

            {/* Visual */}
            <section>
              <h4 className="text-xs font-semibold text-[var(--t-text-muted)] uppercase tracking-wider mb-3">Visual</h4>
              <div className="space-y-3">
                {/* Theme Picker */}
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Tema</label>
                  <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                    {TEMAS.map(tema => (
                      <button
                        key={tema.id}
                        onClick={() => onUpdate(p => {
                          p.visual.tema = tema.id;
                          p.visual.cor_primaria = tema.cor_primaria;
                          p.visual.cor_secundaria = tema.cor_secundaria;
                          p.visual.cor_texto = tema.cor_texto;
                          p.visual.cor_fundo = tema.cor_fundo;
                          p.visual.fonte = tema.fonte;
                          return p;
                        })}
                        className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all ${
                          proposta.visual.tema === tema.id
                            ? 'border-[var(--t-green)] ring-1 ring-[var(--t-green)]'
                            : 'border-[var(--t-border)] hover:border-[var(--t-text-muted)]'
                        }`}
                        title={tema.descricao}
                      >
                        <div
                          className="w-full h-5 rounded"
                          style={{ background: tema.preview_gradient }}
                        />
                        <span className="text-[9px] text-[var(--t-text-muted)] leading-tight">{tema.nome}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {/* Layout toggle */}
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Layout da proposta</label>
                  <div className="flex gap-1.5 mt-1.5">
                    {([
                      { id: 'CLASSICO' as LayoutProposta, label: 'Classico', desc: 'Blocos em sequencia' },
                      { id: 'DISCOVERY' as LayoutProposta, label: 'Discovery', desc: 'Estilo Wetu (pro)' },
                    ]).map(layout => (
                      <button
                        key={layout.id}
                        onClick={() => onUpdate(p => { p.visual.layout = layout.id; return p; })}
                        className={`flex-1 p-2 rounded-lg border text-center transition-all ${
                          (proposta.visual.layout || 'CLASSICO') === layout.id
                            ? 'border-[var(--t-green)] bg-[var(--t-green)]/10'
                            : 'border-[var(--t-border)] hover:border-[var(--t-text-muted)]'
                        }`}
                      >
                        <div className={`text-xs font-medium ${(proposta.visual.layout || 'CLASSICO') === layout.id ? 'text-[var(--t-green)]' : 'text-[var(--t-text)]'}`}>{layout.label}</div>
                        <div className="text-[9px] text-[var(--t-text-muted)]">{layout.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Discovery-specific fields */}
                {(proposta.visual.layout === 'DISCOVERY') && (
                  <>
                    <div>
                      <label className="text-xs text-[var(--t-text-secondary)]">Logo da agencia</label>
                      <div className="mt-1 space-y-2">
                        <ImageUpload
                          compact
                          currentUrl={proposta.visual.logo_agencia || ''}
                          onUpload={urls => onUpdate(p => { p.visual.logo_agencia = urls[0]; return p; })}
                          onRemove={() => onUpdate(p => { p.visual.logo_agencia = ''; return p; })}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--t-text-secondary)]">Sobre a agencia</label>
                      <textarea
                        value={proposta.viagem?.sobre_agencia || ''}
                        onChange={e => onUpdate(p => ({
                          ...p,
                          viagem: { ...p.viagem!, sobre_agencia: e.target.value },
                        }))}
                        placeholder="Breve descricao da agencia..."
                        rows={3}
                        className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-xs resize-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--t-text-secondary)]">Termos e condicoes</label>
                      <textarea
                        value={proposta.viagem?.termos_condicoes || ''}
                        onChange={e => onUpdate(p => ({
                          ...p,
                          viagem: { ...p.viagem!, termos_condicoes: e.target.value },
                        }))}
                        placeholder="Termos e condicoes da proposta..."
                        rows={4}
                        className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-xs resize-none"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Imagem de capa</label>
                  <div className="mt-1 space-y-2">
                    <ImageUpload
                      compact
                      currentUrl={proposta.visual.imagem_capa}
                      onUpload={urls => onUpdate(p => { p.visual.imagem_capa = urls[0]; return p; })}
                      onRemove={() => onUpdate(p => { p.visual.imagem_capa = ''; return p; })}
                    />
                    <Input
                      value={proposta.visual.imagem_capa}
                      onChange={e => onUpdate(p => { p.visual.imagem_capa = e.target.value; return p; })}
                      placeholder="Ou cole uma URL..."
                      className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Estilo da capa</label>
                  <select
                    value={proposta.visual.estilo_capa}
                    onChange={e => onUpdate(p => { p.visual.estilo_capa = e.target.value as Proposta['visual']['estilo_capa']; return p; })}
                    className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="FULLSCREEN">Fullscreen</option>
                    <option value="SPLIT">Split</option>
                    <option value="MINIMAL">Minimal</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Fonte</label>
                  <select
                    value={proposta.visual.fonte || 'Inter'}
                    onChange={e => onUpdate(p => { p.visual.fonte = e.target.value; return p; })}
                    className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="Inter">Inter (Moderna)</option>
                    <option value="Playfair Display">Playfair Display (Elegante)</option>
                    <option value="Georgia">Georgia (Classica)</option>
                    <option value="system-ui">System UI (Nativa)</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)]">Cor primaria</label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="color"
                        value={proposta.visual.cor_primaria || '#004aad'}
                        onChange={e => onUpdate(p => { p.visual.cor_primaria = e.target.value; return p; })}
                        className="w-8 h-8 rounded cursor-pointer shadow-[var(--t-card-shadow)]"
                      />
                      <Input
                        value={proposta.visual.cor_primaria}
                        onChange={e => onUpdate(p => { p.visual.cor_primaria = e.target.value; return p; })}
                        className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)]">Cor de fundo</label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="color"
                        value={proposta.visual.cor_fundo || '#ffffff'}
                        onChange={e => onUpdate(p => { p.visual.cor_fundo = e.target.value; return p; })}
                        className="w-8 h-8 rounded cursor-pointer shadow-[var(--t-card-shadow)]"
                      />
                      <Input
                        value={proposta.visual.cor_fundo}
                        onChange={e => onUpdate(p => { p.visual.cor_fundo = e.target.value; return p; })}
                        className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Viagem Tab (Discovery mode) --
function ViagemTab({
  proposta, onUpdate, newTag, setNewTag,
}: {
  proposta: Proposta;
  onUpdate: (fn: (p: Proposta) => Proposta) => void;
  newTag: string;
  setNewTag: (v: string) => void;
}) {
  const viagem = proposta.viagem;
  if (!viagem) return null;

  const destinos = viagem.destinos || [];
  const tags = viagem.interesses_tags || [];

  const updateViagem = (patch: Partial<typeof viagem>) => {
    onUpdate(p => ({ ...p, viagem: { ...p.viagem!, ...patch } }));
  };

  const addDestino = () => {
    updateViagem({
      destinos: [...destinos, {
        id: generateId(),
        nome: '',
        dias_inicio: destinos.length > 0 ? destinos[destinos.length - 1].dias_fim + 1 : 1,
        dias_fim: destinos.length > 0 ? destinos[destinos.length - 1].dias_fim + 3 : 3,
        alojamento_ids: [],
      }],
    });
  };

  const updateDestino = (idx: number, patch: Partial<DestinoRoteiro>) => {
    const updated = [...destinos];
    updated[idx] = { ...updated[idx], ...patch };
    updateViagem({ destinos: updated });
  };

  const removeDestino = (idx: number) => {
    updateViagem({ destinos: destinos.filter((_, i) => i !== idx) });
  };

  const addTag = () => {
    if (!newTag.trim()) return;
    updateViagem({ interesses_tags: [...tags, newTag.trim()] });
    setNewTag('');
  };

  const autoOrganize = () => {
    // Infer destinos from ALOJAMENTO blocks
    const alojamentos = viagem.alojamentos || [];
    if (alojamentos.length === 0) return;

    let dayStart = 1;
    const newDestinos: DestinoRoteiro[] = alojamentos.map(a => {
      const noites = a.noites || 1;
      const dest: DestinoRoteiro = {
        id: generateId(),
        nome: a.destino_nome || a.hotel_nome || '',
        dias_inicio: dayStart,
        dias_fim: dayStart + noites - 1,
        alojamento_ids: [a.id],
      };
      dayStart += noites;
      return dest;
    });

    const totalNoites = alojamentos.reduce((sum, a) => sum + (a.noites || 1), 0);
    updateViagem({
      destinos: newDestinos,
      duracao_dias: totalNoites + 1,
      duracao_noites: totalNoites,
    });
  };

  return (
    <div className="p-4 space-y-5">
      {/* Duration */}
      <div>
        <label className="text-xs font-medium text-[var(--t-text-secondary)]">Duracao</label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <div>
            <label className="text-[10px] text-[var(--t-text-muted)]">Dias</label>
            <Input
              type="number"
              min={1}
              value={viagem.duracao_dias || 0}
              onChange={e => updateViagem({ duracao_dias: Number(e.target.value) })}
              className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--t-text-muted)]">Noites</label>
            <Input
              type="number"
              min={0}
              value={viagem.duracao_noites || 0}
              onChange={e => updateViagem({ duracao_noites: Number(e.target.value) })}
              className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
            />
          </div>
        </div>
      </div>

      {/* Interest tags */}
      <div>
        <label className="text-xs font-medium text-[var(--t-text-secondary)]">Tags de interesse</label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {tags.map((tag, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--t-green-bg)] text-[var(--t-green)] text-xs">
              {tag}
              <button
                onClick={() => updateViagem({ interesses_tags: tags.filter((_, j) => j !== i) })}
                className="hover:text-red-400"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1 mt-1.5">
          <Input
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="Nova tag..."
            className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs flex-1"
          />
          <button onClick={addTag} className="px-2 text-[var(--t-green)] text-sm font-bold">+</button>
        </div>
      </div>

      {/* Destinos */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-[var(--t-text-secondary)]">Destinos da viagem</label>
          <button onClick={autoOrganize} className="text-[10px] text-[var(--t-green)] hover:underline">
            Auto-organizar
          </button>
        </div>

        <div className="space-y-2">
          {destinos.map((dest, i) => (
            <div key={dest.id} className="p-2.5 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold text-white" style={{ backgroundColor: 'var(--t-green)' }}>
                  {i + 1}
                </span>
                <Input
                  value={dest.nome}
                  onChange={e => updateDestino(i, { nome: e.target.value })}
                  placeholder="Nome do destino"
                  className="bg-transparent border-[var(--t-border)] text-[var(--t-text)] text-xs flex-1 h-7"
                />
                <button
                  onClick={() => removeDestino(i)}
                  className="text-red-400 hover:text-red-300 text-xs px-1"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[10px] text-[var(--t-text-muted)]">Dia inicio</label>
                  <Input
                    type="number"
                    min={1}
                    value={dest.dias_inicio}
                    onChange={e => updateDestino(i, { dias_inicio: Number(e.target.value) })}
                    className="bg-transparent border-[var(--t-border)] text-[var(--t-text)] text-xs h-7"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--t-text-muted)]">Dia fim</label>
                  <Input
                    type="number"
                    min={1}
                    value={dest.dias_fim}
                    onChange={e => updateDestino(i, { dias_fim: Number(e.target.value) })}
                    className="bg-transparent border-[var(--t-border)] text-[var(--t-text)] text-xs h-7"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addDestino}
          className="w-full mt-2 py-2 rounded-lg border border-dashed border-[var(--t-border)] text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-green)] hover:border-[var(--t-green)] transition-colors"
        >
          + Adicionar destino
        </button>
      </div>

      {/* Summary */}
      {destinos.length > 0 && (
        <div className="p-3 rounded-lg bg-[var(--t-green-bg)] text-xs text-[var(--t-green)]">
          <div className="font-medium mb-1">Timeline</div>
          {destinos.map((d, i) => (
            <div key={d.id} className="flex items-center gap-1.5 py-0.5">
              <span className="w-4 text-center font-bold">{i + 1}</span>
              <span className="flex-1 truncate">{d.nome || '(sem nome)'}</span>
              <span className="text-[10px] opacity-70">D{d.dias_inicio}–D{d.dias_fim}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
