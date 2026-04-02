'use client';

import { useState } from 'react';
import { Proposta, Cliente, Membro, Destino, SecaoProposta } from '@/lib/crm-types';
import { generateId } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { DestinoAutocomplete } from './DestinoAutocomplete';
import { DestinoQuickFill } from './DestinoQuickFill';
import { ImageUpload } from './ImageUpload';

type Tab = 'config' | 'destinos';

interface Props {
  proposta: Proposta;
  clientes: Cliente[];
  membros: Membro[];
  onUpdate: (fn: (p: Proposta) => Proposta) => void;
  onSetAIDestino?: (destino: Destino) => void;
}

export function PropostaSidebar({ proposta, clientes, membros, onUpdate, onSetAIDestino }: Props) {
  const [tab, setTab] = useState<Tab>('config');
  const [selectedDestino, setSelectedDestino] = useState<Destino | null>(null);

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
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'destinos' ? (
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
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)]">Cliente</label>
                  <select
                    value={proposta.cliente_id}
                    onChange={e => {
                      const c = clientes.find(cl => cl.id === e.target.value);
                      onUpdate(p => {
                        p.cliente_id = e.target.value;
                        p.cliente_nome = c ? (c.tipo === 'PF' ? c.nome_completo : c.nome_fantasia || c.razao_social) : '';
                        if (c && !p.cabecalho.subtitulo) p.cabecalho.subtitulo = `Preparada especialmente para ${p.cliente_nome}`;
                        return p;
                      });
                    }}
                    className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm"
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
                    className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm"
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
                    className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none"
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
                    className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm resize-none"
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
                    className="w-full mt-1 bg-[var(--t-input-bg)] text-[var(--t-text)] border border-[var(--t-border)] rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="FULLSCREEN">Fullscreen</option>
                    <option value="SPLIT">Split</option>
                    <option value="MINIMAL">Minimal</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)]">Cor primaria</label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="color"
                        value={proposta.visual.cor_primaria || '#10b981'}
                        onChange={e => onUpdate(p => { p.visual.cor_primaria = e.target.value; return p; })}
                        className="w-8 h-8 rounded cursor-pointer border border-[var(--t-border)]"
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
                        className="w-8 h-8 rounded cursor-pointer border border-[var(--t-border)]"
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
