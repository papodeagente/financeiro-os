'use client';

import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  // Identificador da secao de pagina. Aceita os keys especiais usados
  // pelo PropostaEditor pra rotear o painel direito.
  id: '__page_header__' | '__page_footer__' | '__opening_message__';
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  // Tons distintos por tipo de secao de pagina pra ajudar o usuario
  // a diferenciar visualmente do que e bloco normal (azul Elementor).
  // Capa/rodape usam roxo (page-level), bloco usa azul (content).
  accentColor?: string;
}

// Wrapper especifico para secoes de PAGINA (capa, mensagem abertura,
// rodape). Diferenca pro SelectableBlock:
// - Sem drag handle (essas secoes nao mudam de posicao)
// - Sem botoes duplicar/ocultar/deletar (sao parte estrutural da pagina)
// - So mini-toolbar com "Editar" + label do tipo
// - Cor roxa (vs azul) pra distinguir visualmente
//
// Click no wrapper seleciona a secao e abre seu editor especifico no
// painel direito (PageHeaderEditor / PageFooterEditor).
export function SelectablePageSection({
  label, selected, onSelect, children, accentColor = '#8B5CF6',
}: Props) {
  const hoverColor = '#A78BFA';

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className="relative group cursor-pointer"
    >
      {/* Outline da selecao/hover — sutil pra nao competir com o
          conteudo da capa/rodape (que geralmente sao visualmente densos). */}
      <div
        className={`absolute -inset-0.5 pointer-events-none rounded-lg transition-all ${
          selected
            ? 'ring-2 shadow-lg'
            : 'ring-0 group-hover:ring-2'
        }`}
        style={
          selected
            ? { boxShadow: `0 10px 25px -8px ${accentColor}40`, ['--tw-ring-color' as never]: accentColor }
            : { ['--tw-ring-color' as never]: hoverColor + '80' }
        }
      />

      {/* Mini-toolbar simplificada: so label + botao Editar (page sections
          nao tem drag/dup/hide/delete). */}
      <div
        className={`absolute -top-7 left-0 right-0 flex items-center justify-between pointer-events-none transition-opacity z-20 ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <div
          className="pointer-events-auto inline-flex items-center gap-1 px-2 h-6 rounded-t-md text-[10px] uppercase tracking-wider font-semibold text-white shadow-sm"
          style={{ background: selected ? accentColor : hoverColor }}
        >
          {label}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className="pointer-events-auto inline-flex items-center gap-1 px-2 h-6 rounded-t-md text-[10px] uppercase tracking-wider font-semibold text-white shadow-sm transition-colors hover:brightness-110"
          style={{ background: selected ? accentColor : hoverColor }}
          title={`Editar ${label.toLowerCase()}`}
        >
          <Pencil className="w-3 h-3" />
          Editar
        </button>
      </div>

      {/* Conteudo renderizado — pointer-events-none pra que clicks no
          conteudo passem direto pro wrapper externo (selecao). */}
      <div className="pointer-events-none">
        {children}
      </div>
    </div>
  );
}
