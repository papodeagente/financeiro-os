'use client';

import type { ReactNode } from 'react';
import { usePreviewEditor, type PreviewEditorBlockType } from '../PreviewEditorContext';

interface Props {
  // Id de identificacao do bloco (depende do blockType):
  // - 'SECAO_ID': passa SecaoProposta.id direto
  // - 'ALOJAMENTO' / 'VOO_OR_TRANSPORTE' / 'ROTEIRO_DIA': passa conteudo.id
  // - 'VALORES_OR_INCLUSOS': passa SecaoProposta.id
  id: string;
  blockType: PreviewEditorBlockType;
  children: ReactNode;
}

// Wrapper que detecta modo editor (via PreviewEditorContext) e adiciona:
// - Click handler que dispara onBlockSelect
// - Outline azul no hover pra indicar interatividade
//
// Em modo publico (sem context) e transparente — apenas renderiza
// children sem mudancas. Garante que /p/[slug] continua identico.
export function EditorClickable({ id, blockType, children }: Props) {
  const { onBlockSelect } = usePreviewEditor();

  if (!onBlockSelect) {
    return <>{children}</>;
  }

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onBlockSelect(blockType, id);
      }}
      className="relative cursor-pointer group/editblock transition-all"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onBlockSelect(blockType, id);
        }
      }}
    >
      {/* Outline no hover — usa ring inset pra nao mexer no layout */}
      <div
        className="absolute inset-0 pointer-events-none ring-0 group-hover/editblock:ring-2 group-hover/editblock:ring-blue-300/70 ring-inset transition-all z-10"
      />
      {/* Mini hint flutuante no canto superior direito */}
      <div className="absolute top-3 right-3 z-20 opacity-0 group-hover/editblock:opacity-100 transition-opacity pointer-events-none">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-500 text-white text-[10px] uppercase tracking-wider font-semibold shadow-md">
          ✏ Clique para editar
        </span>
      </div>
      {children}
    </div>
  );
}
