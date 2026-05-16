'use client';

import { X, MessageSquare, User, Phone, Mail } from 'lucide-react';
import type { Proposta } from '@/lib/crm-types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  proposta: Proposta;
  onUpdate: (fn: (p: Proposta) => Proposta) => void;
  onClose: () => void;
}

// Editor lateral direito para o RODAPE da proposta. Aberto quando o
// usuario clica na secao de rodape no canvas. Edita proposta.rodape.
// Usa os mesmos hooks de update do PropostaEditor (auto-save + undo).
export function PageFooterEditor({ proposta, onUpdate, onClose }: Props) {
  return (
    <aside
      className="w-[360px] shrink-0 border-l border-[var(--t-border)] bg-[var(--t-surface)] flex flex-col overflow-hidden"
      aria-label="Editar rodapé da proposta"
    >
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-[var(--t-border)] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md flex items-center justify-center bg-purple-500/10">
            <MessageSquare className="w-4 h-4 text-purple-500" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)]">Editando</div>
            <div className="text-sm font-medium text-[var(--t-text)] truncate">Rodapé da proposta</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]"
          title="Fechar (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Mensagem do rodape */}
        <div>
          <Label className="flex items-center gap-1.5 text-xs">
            <MessageSquare className="w-3 h-3" /> Mensagem de encerramento
          </Label>
          <Textarea
            rows={4}
            value={proposta.rodape.mensagem || ''}
            onChange={e => onUpdate(p => { p.rodape.mensagem = e.target.value; return p; })}
            placeholder="Mensagem final da proposta, agradecimento, próximos passos..."
            className="resize-none"
          />
        </div>

        {/* Vendedor — header */}
        <div className="pt-2 border-t border-[var(--t-border)]">
          <h4 className="text-[10px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)] mb-2">
            Contato do vendedor
          </h4>

          <div className="space-y-3">
            <div>
              <Label className="flex items-center gap-1.5 text-xs">
                <User className="w-3 h-3" /> Nome
              </Label>
              <Input
                value={proposta.rodape.nome_vendedor || ''}
                onChange={e => onUpdate(p => { p.rodape.nome_vendedor = e.target.value; return p; })}
                placeholder="Nome do vendedor"
              />
            </div>

            <div>
              <Label className="flex items-center gap-1.5 text-xs">
                <Phone className="w-3 h-3" /> WhatsApp
              </Label>
              <Input
                value={proposta.rodape.whatsapp_vendedor || ''}
                onChange={e => onUpdate(p => { p.rodape.whatsapp_vendedor = e.target.value; return p; })}
                placeholder="11999999999"
              />
            </div>

            <div>
              <Label className="flex items-center gap-1.5 text-xs">
                <Phone className="w-3 h-3" /> Telefone
              </Label>
              <Input
                value={proposta.rodape.telefone_vendedor || ''}
                onChange={e => onUpdate(p => { p.rodape.telefone_vendedor = e.target.value; return p; })}
                placeholder="(11) 9999-9999"
              />
            </div>

            <div>
              <Label className="flex items-center gap-1.5 text-xs">
                <Mail className="w-3 h-3" /> E-mail
              </Label>
              <Input
                type="email"
                value={proposta.rodape.email_vendedor || ''}
                onChange={e => onUpdate(p => { p.rodape.email_vendedor = e.target.value; return p; })}
                placeholder="vendedor@empresa.com"
              />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
